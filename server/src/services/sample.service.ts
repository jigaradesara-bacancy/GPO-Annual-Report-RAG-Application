import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Config } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { assertPdfSignature } from './ingestion.service.js';

const MAX_SAMPLE_BYTES = 60 * 1024 * 1024;

/** Locates the configured official report: a previously downloaded copy, otherwise downloads it from the configured URL. */
export async function ensureSamplePdf(cfg: Pick<Config, 'sample'>): Promise<Buffer> {
  try {
    const cached = await fs.readFile(cfg.sample.path);
    assertPdfSignature(cached);
    return cached;
  } catch {
    /* not cached yet: download */
  }
  const url = new URL(cfg.sample.url);
  if (url.protocol !== 'https:') throw new AppError(500, 'SAMPLE_CONFIG', 'SAMPLE_PDF_URL must use https.');
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(90_000), redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_SAMPLE_BYTES) throw new Error('file too large');
    assertPdfSignature(buf);
    await fs.mkdir(path.dirname(cfg.sample.path), { recursive: true });
    await fs.writeFile(cfg.sample.path, buf);
    return buf;
  } catch (err) {
    throw new AppError(
      502,
      'SAMPLE_UNAVAILABLE',
      `The configured report could not be downloaded (${(err as Error).message}). Download it manually from ${cfg.sample.url} and upload it, or place it at ${cfg.sample.path}. No substitute document was used.`,
    );
  }
}
