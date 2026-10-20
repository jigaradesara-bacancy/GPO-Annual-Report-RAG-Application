import { buildConfig, type Config } from './config/env.js';
import { DocumentStore } from './services/document.service.js';
import { EmbeddingService, OpenAIEmbeddingProvider } from './services/embedding.service.js';
import { GenerationService, OpenAIChatModel } from './services/generation.service.js';
import { IngestionService } from './services/ingestion.service.js';
import { extractPages } from './services/pdf-extract.js';
import { RagService } from './services/rag.service.js';
import { RetrievalService } from './services/retrieval.service.js';
import { ChromaVectorStore, type VectorStore } from './services/vector-store.js';
import type { ChatModel } from './services/generation.service.js';
import type { EmbeddingProvider } from './services/embedding.service.js';
import type { PageExtractor } from './services/ingestion.service.js';

export interface Overrides {
  vectorStore?: VectorStore;
  embeddingProvider?: EmbeddingProvider;
  chatModel?: ChatModel;
  extractor?: PageExtractor;
}

export function createContainer(cfg: Config = buildConfig(), o: Overrides = {}) {
  const vectors = o.vectorStore ?? new ChromaVectorStore(cfg.chroma.url, cfg.chroma.collectionBase);
  const provider = o.embeddingProvider ?? new OpenAIEmbeddingProvider(cfg.openai.apiKey, cfg.openai.embeddingModel, cfg.openai.batchSize, cfg.openai.timeoutMs, cfg.openai.maxRetries, cfg.openai.baseURL);
  const chat = o.chatModel ?? new OpenAIChatModel(cfg.openai.apiKey, cfg.openai.chatModel, cfg.openai.timeoutMs, cfg.openai.maxRetries, cfg.openai.baseURL);

  const docs = new DocumentStore(cfg.storageDir);
  const embeddings = new EmbeddingService(provider, vectors);
  const ingestion = new IngestionService(cfg, docs, embeddings, vectors, o.extractor ?? extractPages);
  const retrieval = new RetrievalService(cfg, docs, embeddings, vectors);
  const generation = new GenerationService(cfg, chat);
  const rag = new RagService(retrieval, generation);
  return { cfg, docs, vectors, embeddings, ingestion, retrieval, generation, rag };
}
export type Container = ReturnType<typeof createContainer>;
