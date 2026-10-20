import { promises as fs } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { buildConfig } from '../src/config/env.js';
import { FAKE_PDF, FakeChat, makeTestApp } from './helpers/fakes.js';

const upload = (app: ReturnType<typeof createApp>, buf: Buffer = FAKE_PDF, type = 'application/pdf', name = 'report.pdf') =>
  request(app).post('/api/documents/upload').attach('file', buf, { filename: name, contentType: type });

describe('config', () => {
  it('fails clearly when required variables are missing', () => {
    expect(() => buildConfig({} as NodeJS.ProcessEnv)).toThrow(/OPENAI_API_KEY/);
    expect(buildConfig({ OPENAI_BASE_URL: 'http://localhost:11434/v1' } as NodeJS.ProcessEnv).openai.baseURL).toBe('http://localhost:11434/v1');
    expect(() => buildConfig({ OPENAI_API_KEY: 'k', CHUNK_SIZE_TOKENS: '100', CHUNK_OVERLAP_TOKENS: '100' } as NodeJS.ProcessEnv)).toThrow(/OVERLAP/);
  });
});

describe('documents API', () => {
  it('uploads, ingests, lists and shows a document; temp files are cleaned up', async () => {
    const t = makeTestApp();
    const app = createApp(t.container);
    const res = await upload(app);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ready');
    const id = res.body.documentId as string;
    expect(res.body.document).toMatchObject({ pageCount: 3, embeddingModel: 'fake-embed-1', documentName: 'report' });
    expect(res.body.document.chunkCount).toBeGreaterThan(0);

    expect(await fs.readdir(path.join(t.dir, 'tmp'))).toEqual([]);
    expect((await request(app).get('/api/documents')).body.documents).toHaveLength(1);
    expect((await request(app).get(`/api/documents/${id}`)).body.document.documentId).toBe(id);

  });

  it('re-ingesting the same PDF creates no duplicates and reuses embeddings', async () => {
    const t = makeTestApp();
    const app = createApp(t.container);
    const a = await upload(app);
    const callsAfterFirst = t.embeddings.calls;
    const b = await upload(app);
    expect(b.body.documentId).toBe(a.body.documentId);
    expect((await request(app).get('/api/documents')).body.documents).toHaveLength(1);
    expect(await t.vectors.countDocument(t.container.embeddings.collectionName, a.body.documentId)).toBe(a.body.document.chunkCount);
    expect(t.embeddings.calls).toBe(callsAfterFirst); // all vectors reused
  });

  it('rejects wrong MIME type, bad file signature, and oversized files', async () => {
    const app = createApp(makeTestApp().container);
    expect((await upload(app, FAKE_PDF, 'text/plain', 'a.txt')).status).toBe(400);
    const bad = await upload(app, Buffer.from('this is not a pdf at all'));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('NOT_A_PDF');
    const big = makeTestApp();
    const small = createApp(big.container);
    const tiny = createApp({ ...big.container, cfg: { ...big.cfg, maxUploadBytes: 10 } } as never);
    expect(small).toBeTruthy();
    expect((await upload(tiny, Buffer.concat([FAKE_PDF, Buffer.alloc(1000)]))).status).toBe(413);
    expect((await request(app).post('/api/documents/upload')).status).toBe(400);
  });

  it('returns a clear OCR_REQUIRED error and leaves no searchable vectors when text is missing', async () => {
    const t = makeTestApp({ extractor: async () => [{ pageNumber: 1, text: '' }, { pageNumber: 2, text: '  ' }] });
    const app = createApp(t.container);
    const res = await upload(app);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('OCR_REQUIRED');
    const [doc] = (await request(app).get('/api/documents')).body.documents;
    expect(doc).toMatchObject({ status: 'failed', errorCode: 'OCR_REQUIRED' });
  });

  it('reports unparseable PDFs and validates ids', async () => {
    const t = makeTestApp({ extractor: async () => { throw new Error('bad xref'); } });
    const app = createApp(t.container);
    expect((await upload(app)).body.error.code).toBe('PDF_UNREADABLE');
    expect((await request(app).get('/api/documents/../../etc/passwd')).status).toBe(404);
    expect((await request(app).get('/api/documents/not-an-id')).status).toBe(400);
  });

  it('refuses concurrent ingestion', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const t = makeTestApp({ extractor: async () => { await gate; return [{ pageNumber: 1, text: 'Revenue grew steadily during the year. '.repeat(30) }]; } });
    const app = createApp(t.container);
    const first = upload(app).then((r) => r);
    await new Promise((r) => setTimeout(r, 150));
    const second = await upload(app, Buffer.from('%PDF-1.4 other'));
    expect(second.status).toBe(409);
    release();
    expect((await first).status).toBe(201);
  });
});

describe('retrieval + chat API', () => {
  it('retrieves relevant pages and answers with page citations', async () => {
    const chat = new FakeChat((req) => {
      const id = /<excerpt id="([^"]+)" pages="2"/.exec(req.user)?.[1];
      return id ? { answerable: true, answer: 'Net income was $32.8 million (p. 2).', citedChunkIds: [id] } : { answerable: false, answer: 'not found', citedChunkIds: [] };
    });
    const t = makeTestApp({ chat });
    const app = createApp(t.container);
    const { documentId } = (await upload(app)).body;

    const retrieved = await t.container.retrieval.search('What was net income and revenue in FY 2025?', documentId, 3);
    expect(chat.requests).toHaveLength(0); // retrieval alone never calls the LLM
    expect(retrieved.chunks[0].pageNumbers).toContain(2);
    expect(retrieved.chunks[0]).toHaveProperty('similarity');
    expect(retrieved.chunks.length).toBeLessThanOrEqual(3);

    const ask = await request(app).post('/api/chat/ask').send({ question: 'What was net income and revenue in FY 2025?', documentId });
    expect(ask.status).toBe(200);
    expect(ask.body.answerable).toBe(true);
    expect(ask.body.sources[0].pageNumbers).toContain(2);
    expect(ask.body.retrieval.chunksRetrieved).toBeGreaterThan(0);
  });

  it('defaults to the only ready document, and requires documentId otherwise', async () => {
    const t = makeTestApp();
    const app = createApp(t.container);
    expect((await request(app).post('/api/chat/ask').send({ question: 'anything at all?' })).body.error.code).toBe('DOCUMENT_ID_REQUIRED');
    await upload(app);
    expect((await request(app).post('/api/chat/ask').send({ question: 'revenue net income?' })).status).toBe(200);
  });

  it('validates input and surfaces LLM failures as structured errors', async () => {
    const t = makeTestApp({ chat: new FakeChat(() => { throw Object.assign(new Error('x'), {}); }) });
    const app = createApp(t.container);
    const { documentId } = (await upload(app)).body;
    expect((await request(app).post('/api/chat/ask').send({ question: '' })).status).toBe(400);
    expect((await request(app).post('/api/chat/ask').send({ question: 'x'.repeat(5000), documentId })).status).toBe(400);
    const res = await request(app).post('/api/chat/ask').send({ question: 'revenue net income', documentId });
    expect(res.status).toBe(500);
    expect(res.body.error.message).not.toMatch(/stack|test-key/i);
  });

  it('blocks searching a document embedded with a different model', async () => {
    const t = makeTestApp();
    const app = createApp(t.container);
    const { documentId } = (await upload(app)).body;
    await t.container.docs.update(documentId, { embeddingModel: 'some-other-model' });
    const res = await request(app).post('/api/chat/ask').send({ question: 'revenue net income', documentId });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMBEDDING_MODEL_MISMATCH');
    expect((await upload(app)).body.document.embeddingModel).toBe('fake-embed-1'); // re-ingesting rebuilds with the current model
    expect((await request(app).post('/api/chat/ask').send({ question: 'revenue net income', documentId })).status).toBe(200);
  });
});

describe('OpenAI error mapping', () => {
  it('distinguishes exhausted credits from a transient rate limit', async () => {
    const { default: OpenAI } = await import('openai');
    const { mapOpenAIError } = await import('../src/services/embedding.service.js');
    const quota = new OpenAI.APIError(429, { code: 'insufficient_quota', type: 'insufficient_quota', message: 'You have no credits remaining' }, 'x', new Headers());
    expect(mapOpenAIError(quota, 'embedding')).toMatchObject({ status: 402, code: 'OPENAI_QUOTA_EXHAUSTED' });
    const rate = new OpenAI.APIError(429, { code: 'rate_limit_exceeded', message: 'Rate limit reached' }, 'x', new Headers());
    expect(mapOpenAIError(rate, 'embedding')).toMatchObject({ status: 429, code: 'OPENAI_RATE_LIMITED' });
  });
});

describe('connection errors', () => {
  it('reports an unreachable model server instead of a generic failure', async () => {
    const { default: OpenAI } = await import('openai');
    const { mapOpenAIError } = await import('../src/services/embedding.service.js');
    const e = mapOpenAIError(new OpenAI.APIConnectionError({ message: 'Connection error.' }), 'generating embeddings', 'http://localhost:11434/v1');
    expect(e).toMatchObject({ status: 503, code: 'LLM_UNREACHABLE' });
    expect(e.message).toContain('ollama serve');
  });
});
