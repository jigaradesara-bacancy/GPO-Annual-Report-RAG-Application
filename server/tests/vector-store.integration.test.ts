import { describe, it, expect, afterAll } from 'vitest';
import { ChromaVectorStore } from '../src/services/vector-store.js';
import type { Chunk } from '../src/types/index.js';

/**
 * Talks to a REAL ChromaDB (docker compose up -d). Uses hand-made 3-d vectors so no OpenAI key is needed.
 * Skipped automatically when Chroma is not reachable.
 */
const url = process.env.CHROMA_URL ?? 'http://localhost:8000';
const reachable = await fetch(`${url}/api/v2/heartbeat`).then((r) => r.ok).catch(() => false);
const store = new ChromaVectorStore(url, `vitest_${Date.now()}`);
const collection = store.collectionNameFor('test-model');

const mk = (i: number, doc: string, pages: number[]): Chunk => ({
  chunkId: `${doc}-c${i}`, documentId: doc, documentName: 'Doc', chunkIndex: i, pageNumbers: pages, section: 'S', text: `text ${i}`, tokenCount: 2,
});

describe.skipIf(!reachable)('ChromaVectorStore (live)', () => {
  afterAll(async () => {
    await store.deleteDocument(collection, 'docA');
    await store.deleteDocument(collection, 'docB');
  });

  it('upserts idempotently, queries by cosine distance scoped to a document, and deletes', async () => {
    const items = [
      { chunk: mk(0, 'docA', [1]), embedding: [1, 0, 0], textHash: 'h0', embeddingModel: 'test-model' },
      { chunk: mk(1, 'docA', [2, 3]), embedding: [0, 1, 0], textHash: 'h1', embeddingModel: 'test-model' },
      { chunk: mk(0, 'docB', [9]), embedding: [1, 0, 0], textHash: 'h2', embeddingModel: 'test-model' },
    ];
    await store.upsert(collection, items);
    await store.upsert(collection, items); // re-ingest: no duplicates
    expect(await store.countDocument(collection, 'docA')).toBe(2);

    const hits = await store.query(collection, [0.9, 0.1, 0], 5, 'docA');
    expect(hits.map((h) => h.chunk.chunkId)).toEqual(['docA-c0', 'docA-c1']);
    expect(hits[0].distance).toBeLessThan(hits[1].distance);
    expect(hits[1].chunk.pageNumbers).toEqual([2, 3]);
    expect(hits.every((h) => h.chunk.documentId === 'docA')).toBe(true);

    const existing = await store.getExisting(collection, ['docA-c0', 'nope']);
    expect([...existing.keys()]).toEqual(['docA-c0']);
    expect(existing.get('docA-c0')?.textHash).toBe('h0');

    await store.deleteDocument(collection, 'docA');
    expect(await store.countDocument(collection, 'docA')).toBe(0);
    expect(await store.countDocument(collection, 'docB')).toBe(1);
  });
});
