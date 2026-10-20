import type { Config } from '../config/env.js';
import type { RetrievalResult, RetrievedChunk } from '../types/index.js';
import { conflict, AppError } from '../utils/errors.js';
import type { DocumentStore } from './document.service.js';
import type { EmbeddingService } from './embedding.service.js';
import type { VectorStore } from './vector-store.js';

export class RetrievalService {
  constructor(
    private readonly cfg: Pick<Config, 'retrieval'>,
    private readonly docs: DocumentStore,
    private readonly embeddings: EmbeddingService,
    private readonly vectors: VectorStore,
  ) {}

  /** Resolve the target document. documentId may be omitted only when exactly one document is ready. */
  async resolveDocumentId(documentId?: string): Promise<string> {
    if (documentId) return documentId;
    const ready = (await this.docs.list()).filter((d) => d.status === 'ready');
    if (ready.length === 1) return ready[0].documentId;
    throw new AppError(400, 'DOCUMENT_ID_REQUIRED', ready.length ? 'Several documents are ready; specify documentId.' : 'No ingested document is ready. Ingest a PDF first.');
  }

  async search(question: string, documentId: string, topK = this.cfg.retrieval.topK): Promise<RetrievalResult> {
    const started = Date.now();
    const doc = await this.docs.get(documentId);
    if (doc.status !== 'ready') throw conflict('DOCUMENT_NOT_READY', `Document is ${doc.status}; it must be 'ready' before it can be searched.`);
    if (doc.embeddingModel !== this.embeddings.model || !doc.collectionName) {
      throw conflict(
        'EMBEDDING_MODEL_MISMATCH',
        `Document was embedded with "${doc.embeddingModel}" but the configured model is "${this.embeddings.model}". Ingest the document again (upload it or use ingest-sample) to rebuild it with the current model.`,
      );
    }

    const queryEmbedding = await this.embeddings.embedQuery(question);
    const hits = await this.vectors.query(doc.collectionName, queryEmbedding, topK, documentId);
    const chunks: RetrievedChunk[] = hits
      .map((h) => ({ ...h.chunk, distance: h.distance, similarity: 1 - h.distance }))
      .filter((c) => c.similarity >= this.cfg.retrieval.minSimilarity);

    return {
      question,
      documentId,
      topK,
      minSimilarity: this.cfg.retrieval.minSimilarity,
      embeddingModel: this.embeddings.model,
      chunks,
      candidatesBeforeFilter: hits.length,
      latencyMs: Date.now() - started,
    };
  }
}
