import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildConfig } from '../../src/config/env.js';
import { createContainer } from '../../src/container.js';
import type { EmbeddingProvider } from '../../src/services/embedding.service.js';
import type { ChatModel, LlmRequest, LlmResponse } from '../../src/services/generation.service.js';
import type { VectorStore, VectorHit } from '../../src/services/vector-store.js';
import type { Chunk } from '../../src/types/index.js';

// TEST FIXTURES ONLY. The running application never uses these; it talks to OpenAI and ChromaDB.

/** Deterministic bag-of-words embedding so similar texts get similar vectors. */
export class FakeEmbeddings implements EmbeddingProvider {
  calls = 0;
  constructor(readonly model = 'fake-embed-1') {}
  async embed(texts: string[]) {
    this.calls += texts.length;
    return texts.map((t) => {
      const v = new Array(64).fill(0);
      for (const w of t.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
        let h = 0;
        for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) % 64;
        v[h] += 1;
      }
      return v;
    });
  }
}

export class MemoryVectorStore implements VectorStore {
  data = new Map<string, Map<string, { chunk: Chunk; embedding: number[]; textHash: string }>>();
  collectionNameFor(m: string) { return `test__${m}`; }
  private col(n: string) { if (!this.data.has(n)) this.data.set(n, new Map()); return this.data.get(n)!; }
  async health() {}
  async upsert(c: string, items: Array<{ chunk: Chunk; embedding: number[]; textHash: string }>) { for (const i of items) this.col(c).set(i.chunk.chunkId, i); }
  async getExisting(c: string, ids: string[]) {
    const m = new Map<string, { embedding: number[]; textHash: string }>();
    for (const id of ids) { const e = this.col(c).get(id); if (e) m.set(id, e); }
    return m;
  }
  async query(c: string, emb: number[], topK: number, documentId: string): Promise<VectorHit[]> {
    const norm = (v: number[]) => Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
    return [...this.col(c).values()]
      .filter((e) => e.chunk.documentId === documentId)
      .map((e) => ({ chunk: e.chunk, distance: 1 - e.embedding.reduce((a, b, i) => a + b * emb[i], 0) / (norm(e.embedding) * norm(emb)) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, topK);
  }
  async deleteDocument(c: string, id: string) {
    for (const [k, e] of this.col(c)) if (e.chunk.documentId === id) this.col(c).delete(k);
  }
  async prune(c: string, id: string, keep: Set<string>) { for (const [k, e] of this.col(c)) if (e.chunk.documentId === id && !keep.has(k)) this.col(c).delete(k); }
  async countDocument(c: string, id: string) { return [...this.col(c).values()].filter((e) => e.chunk.documentId === id).length; }
}

export class FakeChat implements ChatModel {
  model = 'fake-chat';
  requests: LlmRequest[] = [];
  constructor(public respond: (req: LlmRequest) => LlmResponse = () => ({ answerable: false, answer: 'not found', citedChunkIds: [] })) {}
  async complete(req: LlmRequest) { this.requests.push(req); return this.respond(req); }
}

export const PAGES = [
  { pageNumber: 1, text: 'GPO is responsible for the production and distribution of information products for all three branches of Government. '.repeat(8) },
  { pageNumber: 2, text: 'During FY 2025 revenue totaled $1,329.7 million and net income was $32.8 million from operations. '.repeat(8) },
  { pageNumber: 3, text: 'The Federal Depository Library Program has 1,089 participating libraries across the nation. '.repeat(8) },
];

export function makeTestApp(over: { chat?: FakeChat; extractor?: (d: Uint8Array) => Promise<Array<{ pageNumber: number; text: string }>> } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'gporag-'));
  const cfg = buildConfig({
    OPENAI_API_KEY: 'test-key', STORAGE_DIR: dir, CHUNK_SIZE_TOKENS: '120', CHUNK_OVERLAP_TOKENS: '20', RETRIEVAL_MIN_SIMILARITY: '0.1',
  } as NodeJS.ProcessEnv);
  const vectors = new MemoryVectorStore();
  const embeddings = new FakeEmbeddings();
  const chat = over.chat ?? new FakeChat();
  const container = createContainer(cfg, { vectorStore: vectors, embeddingProvider: embeddings, chatModel: chat, extractor: over.extractor ?? (async () => PAGES) });
  return { container, vectors, embeddings, chat, cfg, dir };
}
export const FAKE_PDF = Buffer.from('%PDF-1.4\nfake body for tests\n%%EOF');
