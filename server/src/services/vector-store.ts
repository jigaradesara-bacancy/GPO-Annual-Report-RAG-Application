import { ChromaClient, type Collection } from 'chromadb';
import type { Chunk } from '../types/index.js';

export interface StoredChunk extends Chunk {
  embedding?: number[];
  textHash: string;
}

export interface VectorHit {
  chunk: Chunk;
  distance: number;
}

/** Swap this interface to replace ChromaDB with another vector database. */
export interface VectorStore {
  /** Collection that holds vectors for one embedding model. Never mixes models. */
  collectionNameFor(embeddingModel: string): string;
  upsert(collection: string, items: Array<{ chunk: Chunk; embedding: number[]; textHash: string; embeddingModel: string }>): Promise<void>;
  /** Previously stored embeddings for the given chunk IDs (used to skip re-embedding unchanged text). */
  getExisting(collection: string, ids: string[]): Promise<Map<string, { embedding: number[]; textHash: string }>>;
  query(collection: string, embedding: number[], topK: number, documentId: string): Promise<VectorHit[]>;
  deleteDocument(collection: string, documentId: string): Promise<void>;
  /** Remove this document's vectors whose IDs are not in keepIds (e.g. after re-chunking produced fewer chunks). */
  prune(collection: string, documentId: string, keepIds: Set<string>): Promise<void>;
  countDocument(collection: string, documentId: string): Promise<number>;
  health(): Promise<void>;
}

type Meta = Record<string, string | number | boolean>;

function metaToChunk(id: string, text: string, m: Meta): Chunk {
  return {
    chunkId: id,
    documentId: String(m.documentId),
    documentName: String(m.documentName),
    chunkIndex: Number(m.chunkIndex),
    pageNumbers: String(m.pageNumbers).split(',').filter(Boolean).map(Number),
    section: m.section ? String(m.section) : undefined,
    tokenCount: Number(m.tokenCount),
    text,
  };
}

export class ChromaVectorStore implements VectorStore {
  private client: ChromaClient;
  private collections = new Map<string, Collection>();

  constructor(
    url: string,
    private readonly collectionBase: string,
  ) {
    const u = new URL(url);
    this.client = new ChromaClient({ host: u.hostname, port: Number(u.port || (u.protocol === 'https:' ? 443 : 8000)), ssl: u.protocol === 'https:' });
  }

  collectionNameFor(embeddingModel: string): string {
    const slug = embeddingModel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    // Chroma collection names: 3-512 chars, alphanumeric/./_/- only.
    return `${this.collectionBase}__${slug}`.slice(0, 200);
  }

  private async collection(name: string, embeddingModel?: string): Promise<Collection> {
    const cached = this.collections.get(name);
    if (cached) return cached;
    const col = await this.client.getOrCreateCollection({
      name,
      embeddingFunction: null, // we always supply our own vectors
      configuration: { hnsw: { space: 'cosine' } },
      metadata: embeddingModel ? { embeddingModel } : undefined,
    });
    this.collections.set(name, col);
    return col;
  }

  async health() {
    await this.client.heartbeat();
  }

  async upsert(name: string, items: Array<{ chunk: Chunk; embedding: number[]; textHash: string; embeddingModel: string }>) {
    if (!items.length) return;
    const col = await this.collection(name, items[0].embeddingModel);
    for (let i = 0; i < items.length; i += 200) {
      const part = items.slice(i, i + 200);
      await col.upsert({
        ids: part.map((p) => p.chunk.chunkId),
        embeddings: part.map((p) => p.embedding),
        documents: part.map((p) => p.chunk.text),
        metadatas: part.map(
          (p): Meta => ({
            documentId: p.chunk.documentId,
            documentName: p.chunk.documentName,
            chunkIndex: p.chunk.chunkIndex,
            pageNumbers: p.chunk.pageNumbers.join(','),
            section: p.chunk.section ?? '',
            tokenCount: p.chunk.tokenCount,
            textHash: p.textHash,
            embeddingModel: p.embeddingModel,
          }),
        ),
      });
    }
  }

  async getExisting(name: string, ids: string[]) {
    const out = new Map<string, { embedding: number[]; textHash: string }>();
    if (!ids.length) return out;
    const col = await this.collection(name);
    for (let i = 0; i < ids.length; i += 200) {
      const res = await col.get({ ids: ids.slice(i, i + 200), include: ['embeddings', 'metadatas'] });
      res.ids.forEach((id, j) => {
        const emb = res.embeddings?.[j];
        const hash = res.metadatas?.[j]?.textHash;
        if (emb && typeof hash === 'string') out.set(id, { embedding: Array.from(emb), textHash: hash });
      });
    }
    return out;
  }

  async query(name: string, embedding: number[], topK: number, documentId: string): Promise<VectorHit[]> {
    const col = await this.collection(name);
    const res = await col.query({
      queryEmbeddings: [embedding],
      nResults: topK,
      where: { documentId },
      include: ['documents', 'metadatas', 'distances'],
    });
    const ids = res.ids[0] ?? [];
    return ids.map((id, i) => ({
      chunk: metaToChunk(id, res.documents[0]?.[i] ?? '', (res.metadatas[0]?.[i] ?? {}) as Meta),
      distance: res.distances?.[0]?.[i] ?? Number.NaN,
    }));
  }

  async deleteDocument(name: string, documentId: string) {
    const col = await this.collection(name);
    await col.delete({ where: { documentId } });
  }

  async prune(name: string, documentId: string, keepIds: Set<string>) {
    const col = await this.collection(name);
    const res = await col.get({ where: { documentId }, include: [] });
    const stale = res.ids.filter((id) => !keepIds.has(id));
    if (stale.length) await col.delete({ ids: stale });
  }

  async countDocument(name: string, documentId: string) {
    const col = await this.collection(name);
    const res = await col.get({ where: { documentId }, include: [] });
    return res.ids.length;
  }
}
