import OpenAI from 'openai';
import { createHash } from 'node:crypto';
import type { Chunk } from '../types/index.js';
import type { VectorStore } from './vector-store.js';
import { AppError } from '../utils/errors.js';

/** Swap this interface to use another embedding provider. */
export interface EmbeddingProvider {
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
}

export function mapOpenAIError(err: unknown, what: string, baseURL?: string): AppError {
  // APIConnectionError (and its timeout subclass) extend APIError but carry no HTTP status, so check them first.
  if (err instanceof OpenAI.APIConnectionTimeoutError) return new AppError(504, 'LLM_TIMEOUT', `The model server timed out while ${what}. Raise OPENAI_TIMEOUT_MS (local CPU models can be slow).`);
  if (err instanceof OpenAI.APIConnectionError) {
    const where = baseURL ?? process.env.OPENAI_BASE_URL ?? 'api.openai.com';
    return new AppError(503, 'LLM_UNREACHABLE', `Could not connect to the model server at ${where} while ${what}. If you use Ollama, make sure it is installed and running ("ollama serve"); otherwise check your network.`);
  }
  if (err instanceof OpenAI.APIError) {
    const quota = err.status === 429 && /quota|credit/i.test(`${err.code ?? ''} ${err.type ?? ''} ${err.message}`);
    if (quota) return new AppError(402, 'OPENAI_QUOTA_EXHAUSTED', `Your OpenAI account has no remaining credits/quota (while ${what}). Add credits at https://platform.openai.com/settings/organization/billing/ . Retrying will not help until then.`);
    if (err.status === 429) return new AppError(429, 'OPENAI_RATE_LIMITED', `OpenAI rate limit or quota exceeded while ${what}. Try again shortly or check your plan/billing.`);
    if (err.status === 401) return new AppError(502, 'OPENAI_AUTH', `OpenAI rejected the API key while ${what}. Check OPENAI_API_KEY.`);
    if (err.status === 404) return new AppError(502, 'OPENAI_MODEL', `OpenAI model not found while ${what}. Check the model name in your .env (for Ollama: run "ollama pull <model>").`);
    return new AppError(502, 'OPENAI_ERROR', `Model request failed while ${what} (HTTP ${err.status ?? 'unknown'}): ${String(err.message).slice(0, 200)}`);
  }
  if (err instanceof OpenAI.APIConnectionError) return new AppError(504, 'OPENAI_TIMEOUT', `Could not reach OpenAI (timeout or network error) while ${what}.`);
  return err instanceof AppError ? err : new AppError(500, 'INTERNAL', `Unexpected error while ${what}.`);
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private client: OpenAI;
  constructor(
    apiKey: string,
    readonly model: string,
    private readonly batchSize: number,
    timeout: number,
    maxRetries: number,
    baseURL?: string,
  ) {
    // The SDK retries 408/409/429/5xx with exponential backoff (honours Retry-After).
    this.client = new OpenAI({ apiKey, baseURL, timeout, maxRetries });
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      try {
        const res = await this.client.embeddings.create({ model: this.model, input: texts.slice(i, i + this.batchSize) });
        out.push(...res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
      } catch (err) {
        throw mapOpenAIError(err, 'generating embeddings');
      }
    }
    return out;
  }
}

export const hashText = (t: string) => createHash('sha256').update(t).digest('hex').slice(0, 32);

/** Embeds chunks (reusing stored vectors for unchanged text) and writes them to the vector store. */
export class EmbeddingService {
  constructor(
    private readonly provider: EmbeddingProvider,
    private readonly store: VectorStore,
  ) {}

  get model() {
    return this.provider.model;
  }
  get collectionName() {
    return this.store.collectionNameFor(this.provider.model);
  }

  embedQuery(question: string): Promise<number[]> {
    return this.provider.embed([question]).then((r) => r[0]);
  }

  async embedAndStore(chunks: Chunk[]): Promise<{ embedded: number; reused: number }> {
    const collection = this.collectionName;
    const existing = await this.store.getExisting(collection, chunks.map((c) => c.chunkId));
    const items: Array<{ chunk: Chunk; embedding: number[]; textHash: string; embeddingModel: string }> = [];
    const toEmbed: Array<{ chunk: Chunk; textHash: string }> = [];

    for (const chunk of chunks) {
      const textHash = hashText(chunk.text);
      const prev = existing.get(chunk.chunkId);
      if (prev && prev.textHash === textHash) items.push({ chunk, embedding: prev.embedding, textHash, embeddingModel: this.model });
      else toEmbed.push({ chunk, textHash });
    }
    const vectors = await this.provider.embed(toEmbed.map((t) => t.chunk.text));
    toEmbed.forEach((t, i) => items.push({ ...t, embedding: vectors[i], embeddingModel: this.model }));

    await this.store.upsert(collection, items);
    return { embedded: toEmbed.length, reused: items.length - toEmbed.length };
  }
}
