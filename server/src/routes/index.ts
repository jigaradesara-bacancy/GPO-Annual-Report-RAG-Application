import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Container } from '../container.js';
import { askLimiter, heavyLimiter, requestTimeout } from '../middleware/limits.js';
import { createUpload } from '../middleware/upload.js';
import { ensureSamplePdf } from '../services/sample.service.js';
import { badRequest } from '../utils/errors.js';

const idParam = z.object({ documentId: z.string().regex(/^[a-f0-9]{16}$/, 'invalid document id') });
const question = (max: number) => z.string().trim().min(3, 'question is too short').max(max, `question must be at most ${max} characters`);

// Express 5 forwards rejected promises to the error handler, so handlers can simply be async.
export function createRouter(c: Container): Router {
  const r = Router();
  const upload = createUpload(c.cfg.storageDir, c.cfg.maxUploadBytes);
  const longTimeout = requestTimeout(10 * 60_000);
  const chatTimeout = requestTimeout(2 * 60_000);

  r.get('/health', async (_req, res) => {
    const chroma = await c.vectors.health().then(() => 'ok', () => 'unreachable');
    res.status(chroma === 'ok' ? 200 : 503).json({
      status: chroma === 'ok' ? 'ok' : 'degraded',
      chroma,
      embeddingModel: c.embeddings.model,
      chatModel: c.generation.model,
      ingestionBusy: c.ingestion.isBusy,
    });
  });

  // ---- documents ----
  r.get('/documents', async (_req, res) => {
    res.json({ documents: await c.docs.list() });
  });

  r.get('/documents/:documentId', async (req, res) => {
    const { documentId } = idParam.parse(req.params);
    const doc = await c.docs.get(documentId);
    res.json({ document: doc, currentEmbeddingModel: c.embeddings.model });
  });

  const uploadHandler: RequestHandler = async (req, res) => {
    const file = req.file;
    if (!file) throw badRequest('NO_FILE', 'Attach a PDF in the "file" form field.');
    let doc;
    try {
      const { documentName } = z.object({ documentName: z.string().trim().min(1).max(200).optional() }).parse(req.body);
      const original = path.basename(file.originalname || 'document.pdf').slice(0, 200);
      const buffer = await fs.readFile(file.path);
      doc = await c.ingestion.ingest({ buffer, fileName: original, documentName: documentName ?? original.replace(/\.pdf$/i, '') });
    } finally {
      await fs.rm(file.path, { force: true }); // always clean up the temp file, before responding
    }
    res.status(201).json({ documentId: doc.documentId, status: doc.status, document: doc });
  };
  r.post('/documents/upload', heavyLimiter, longTimeout, upload, uploadHandler);

  r.post('/documents/ingest-sample', heavyLimiter, longTimeout, async (_req, res) => {
    const buffer = await ensureSamplePdf(c.cfg);
    const doc = await c.ingestion.ingest({ buffer, fileName: path.basename(c.cfg.sample.path), documentName: c.cfg.sample.documentName });
    res.status(201).json({ documentId: doc.documentId, status: doc.status, document: doc });
  });

  // ---- question answering ----
  r.post('/chat/ask', askLimiter, chatTimeout, async (req, res) => {
    const body = z.object({ question: question(c.cfg.generation.maxQuestionChars), documentId: idParam.shape.documentId.optional() }).parse(req.body);
    res.json(await c.rag.ask(body.question, body.documentId));
  });

  return r;
}
