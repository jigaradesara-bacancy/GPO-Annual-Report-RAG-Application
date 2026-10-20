import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import type { Container } from './container.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { generalLimiter } from './middleware/limits.js';
import { createRouter } from './routes/index.js';

export function createApp(c: Container) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: c.cfg.clientUrl }));
  app.use(express.json({ limit: '50kb' })); // questions are short; uploads go through multer
  app.use('/api', generalLimiter, createRouter(c));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
