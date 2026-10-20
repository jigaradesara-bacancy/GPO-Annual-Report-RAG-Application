import { createHash } from 'node:crypto';
import type { Config } from '../config/env.js';
import type { DocumentRecord, PageText } from '../types/index.js';
import { AppError, badRequest, conflict } from '../utils/errors.js';
import { cleanText } from '../utils/text.js';
import { logger } from '../utils/logger.js';
import { chunkPages } from './chunking.service.js';
import type { DocumentStore } from './document.service.js';
import type { EmbeddingService } from './embedding.service.js';
import type { ExtractedPage } from './pdf-extract.js';
import type { VectorStore } from './vector-store.js';

export type PageExtractor = (data: Uint8Array) => Promise<ExtractedPage[]>;

export interface IngestInput {
  buffer: Buffer;
  fileName: string;
  documentName: string;
}

export function assertPdfSignature(buf: Buffer) {
  if (!buf.subarray(0, 1024).toString('latin1').includes('%PDF-')) {
    throw badRequest('NOT_A_PDF', 'The file is not a valid PDF (missing %PDF header).');
  }
}

export class IngestionService {
  /** Only one ingestion at a time: it is CPU heavy and rate-limited by the embedding API. */
  private busy = false;

  constructor(
    private readonly cfg: Pick<Config, 'chunking' | 'minExtractedCharsPerPage' | 'maxUploadBytes'>,
    private readonly docs: DocumentStore,
    private readonly embeddings: EmbeddingService,
    private readonly vectors: VectorStore,
    private readonly extract: PageExtractor,
  ) {}

  get isBusy() {
    return this.busy;
  }

  async ingest(input: IngestInput): Promise<DocumentRecord> {
    if (input.buffer.length > this.cfg.maxUploadBytes) throw badRequest('FILE_TOO_LARGE', 'PDF exceeds the maximum upload size.');
    assertPdfSignature(input.buffer);
    const documentId = createHash('sha256').update(input.buffer).digest('hex').slice(0, 16);
    return this.run(documentId, input);
  }

  private async run(documentId: string, input: IngestInput): Promise<DocumentRecord> {
    if (this.busy) throw conflict('INGESTION_BUSY', 'Another ingestion is already running. Try again when it has finished.');
    this.busy = true;
    const now = new Date().toISOString();
    const previous = await this.docs.find(documentId);
    const collection = this.embeddings.collectionName;
    try {
      await this.docs.save({
        documentId,
        documentName: input.documentName,
        originalFileName: input.fileName,
        fileSizeBytes: input.buffer.length,
        status: 'extracting',
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
        lastIngestedAt: previous?.lastIngestedAt,
      });

      // 1. Extract text page by page
      let extracted: ExtractedPage[];
      try {
        extracted = await this.extract(new Uint8Array(input.buffer));
      } catch (err) {
        logger.warn({ err: (err as Error).message, documentId }, 'pdf extraction failed');
        throw new AppError(422, 'PDF_UNREADABLE', 'The PDF could not be parsed. It may be corrupted, encrypted or malformed.');
      }
      const pages: PageText[] = extracted.map((p) => ({ pageNumber: p.pageNumber, text: cleanText(p.text) }));
      const chars = pages.reduce((n, p) => n + p.text.replace(/\s/g, '').length, 0);
      if (!pages.length || chars < 200 || chars / pages.length < this.cfg.minExtractedCharsPerPage) {
        throw new AppError(
          422,
          'OCR_REQUIRED',
          `Too little text could be extracted (${chars} characters over ${pages.length} pages). The PDF is probably scanned images and needs OCR, which this application does not support.`,
        );
      }

      // 2. Chunk
      await this.docs.update(documentId, { status: 'chunking', pageCount: pages.length });
      const chunks = chunkPages(pages, { documentId, documentName: input.documentName }, this.cfg.chunking);
      if (!chunks.length) throw new AppError(422, 'NO_CHUNKS', 'No text chunks could be produced from this PDF.');

      // 3. Embed + store (reuses vectors for unchanged chunks; upsert by chunk ID prevents duplicates)
      await this.docs.update(documentId, { status: 'embedding', chunkCount: chunks.length });
      const stats = await this.embeddings.embedAndStore(chunks);
      await this.vectors.prune(collection, documentId, new Set(chunks.map((c) => c.chunkId)));
      const stored = await this.vectors.countDocument(collection, documentId);
      if (stored !== chunks.length) {
        throw new AppError(500, 'VECTOR_COUNT_MISMATCH', `Vector store holds ${stored} chunks but ${chunks.length} were expected.`);
      }

      // 4. A different embedding model used previously leaves vectors in another collection: remove them.
      if (previous?.collectionName && previous.collectionName !== collection) {
        await this.vectors.deleteDocument(previous.collectionName, documentId).catch((e) => logger.warn({ err: String(e) }, 'old collection cleanup failed'));
      }

      logger.info({ documentId, pages: pages.length, chunks: chunks.length, ...stats }, 'ingestion complete');
      return await this.docs.update(documentId, {
        status: 'ready',
        errorCode: undefined,
        errorMessage: undefined,
        pageCount: pages.length,
        chunkCount: chunks.length,
        embeddingModel: this.embeddings.model,
        collectionName: collection,
        chunkSizeTokens: this.cfg.chunking.sizeTokens,
        chunkOverlapTokens: this.cfg.chunking.overlapTokens,
        lastIngestedAt: new Date().toISOString(),
      });
    } catch (err) {
      const appErr = err instanceof AppError ? err : new AppError(500, 'INGESTION_FAILED', 'Ingestion failed unexpectedly.');
      // Clean up partial work so a failed ingestion never leaves half a document searchable.
      await this.vectors.deleteDocument(collection, documentId).catch(() => undefined);
      await this.docs
        .update(documentId, { status: 'failed', errorCode: appErr.code, errorMessage: appErr.message, chunkCount: 0, collectionName: undefined, embeddingModel: undefined })
        .catch(() => undefined);
      if (!(err instanceof AppError)) logger.error({ err: (err as Error).message, documentId }, 'ingestion failed');
      throw appErr;
    } finally {
      this.busy = false;
    }
  }
}
