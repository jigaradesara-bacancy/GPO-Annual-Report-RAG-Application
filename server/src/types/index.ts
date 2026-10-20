export type IngestionStatus = 'pending' | 'extracting' | 'chunking' | 'embedding' | 'ready' | 'failed';

export interface DocumentRecord {
  documentId: string; // sha256 of the PDF bytes (first 16 hex chars): re-ingesting the same file reuses the ID
  documentName: string;
  originalFileName: string;
  fileSizeBytes: number;
  status: IngestionStatus;
  errorCode?: string;
  errorMessage?: string;
  pageCount?: number;
  chunkCount?: number;
  embeddingModel?: string;
  collectionName?: string;
  chunkSizeTokens?: number;
  chunkOverlapTokens?: number;
  createdAt: string;
  updatedAt: string;
  lastIngestedAt?: string;
}

export interface PageText {
  pageNumber: number; // 1-based PDF page index (not the printed folio)
  text: string;
}

export interface Chunk {
  chunkId: string;
  documentId: string;
  documentName: string;
  chunkIndex: number;
  pageNumbers: number[];
  section?: string;
  text: string;
  tokenCount: number;
}

export interface RetrievedChunk extends Chunk {
  /** Cosine distance reported by the vector store (lower = closer). */
  distance: number;
  /** 1 - distance. A ranking signal only; NOT a probability that the chunk answers the question. */
  similarity: number;
}

export interface RetrievalResult {
  question: string;
  documentId: string;
  topK: number;
  minSimilarity: number;
  embeddingModel: string;
  chunks: RetrievedChunk[];
  /** Chunks the store returned before the similarity cut-off. */
  candidatesBeforeFilter: number;
  latencyMs: number;
}

export interface SourceCitation {
  documentId: string;
  documentName: string;
  pageNumbers: number[];
  chunkId: string;
  excerpt: string;
  similarity: number;
}

export interface AnswerResult {
  answer: string;
  /** false when the report content retrieved does not answer the question. */
  answerable: boolean;
  sources: SourceCitation[];
  /** Non-fatal grounding problems, e.g. the model cited no valid chunk. */
  warnings: string[];
  retrieval: {
    chunksRetrieved: number;
    chunksSentToModel: number;
    topK: number;
    minSimilarity: number;
    embeddingModel: string;
    chatModel: string;
    chunks: Array<{ chunkId: string; pageNumbers: number[]; similarity: number; distance: number }>;
  };
  latencyMs: { retrieval: number; generation: number; total: number };
}
