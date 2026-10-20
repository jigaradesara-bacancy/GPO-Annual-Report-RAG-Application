export type IngestionStatus = 'pending' | 'extracting' | 'chunking' | 'embedding' | 'ready' | 'failed';

export interface DocumentRecord {
  documentId: string;
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
  createdAt: string;
  updatedAt: string;
  lastIngestedAt?: string;
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
  answerable: boolean;
  sources: SourceCitation[];
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
