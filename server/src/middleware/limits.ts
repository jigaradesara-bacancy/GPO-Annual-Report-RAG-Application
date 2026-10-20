import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AppError } from '../utils/errors.js';

const handler = (_req: unknown, _res: unknown, next: (e: unknown) => void) => next(new AppError(429, 'RATE_LIMITED', 'Too many requests. Please slow down and retry shortly.'));

const make = (windowMs: number, limit: number) => rateLimit({ windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, handler: handler as never });

/** Expensive operations (ingest, upload, delete, evaluation). */
export const heavyLimiter = make(15 * 60_000, 30);
/** Each question costs an embedding call plus a chat call. */
export const askLimiter = make(60_000, 30);
export const generalLimiter = make(60_000, 300);

export const requestTimeout =
  (ms: number): RequestHandler =>
  (_req, res, next) => {
    const t = setTimeout(() => {
      if (!res.headersSent) next(new AppError(503, 'REQUEST_TIMEOUT', `Request timed out after ${Math.round(ms / 1000)}s.`));
    }, ms);
    res.on('finish', () => clearTimeout(t));
    res.on('close', () => clearTimeout(t));
    next();
  };
