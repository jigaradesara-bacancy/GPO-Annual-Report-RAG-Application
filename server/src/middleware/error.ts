import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export const notFoundHandler: RequestHandler = (req, _res, next) => next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found.`));

/** Single place where every error becomes a JSON response. Internal details are logged, never returned. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (res.headersSent) return;
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request.', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } });
    return;
  }
  if (err instanceof multer.MulterError) {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    res.status(tooBig ? 413 : 400).json({ error: { code: tooBig ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR', message: tooBig ? 'PDF exceeds the maximum upload size.' : `Upload error: ${err.message}` } });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON.' } });
    return;
  }
  logger.error({ err: err instanceof Error ? err.message : String(err) }, 'unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error.' } });
};
