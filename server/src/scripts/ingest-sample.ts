import path from 'node:path';
import { createContainer } from '../container.js';
import { ensureSamplePdf } from '../services/sample.service.js';

const c = createContainer();
const buffer = await ensureSamplePdf(c.cfg);
const doc = await c.ingestion.ingest({ buffer, fileName: path.basename(c.cfg.sample.path), documentName: c.cfg.sample.documentName });
console.log(doc);
