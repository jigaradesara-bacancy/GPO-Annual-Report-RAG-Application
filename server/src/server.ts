import { createApp } from './app.js';
import { buildConfig } from './config/env.js';
import { createContainer } from './container.js';
import { logger } from './utils/logger.js';

let cfg;
try {
  cfg = buildConfig();
} catch (err) {
  console.error((err as Error).message);
  console.error('Copy .env.example to .env and fill in the missing values.');
  process.exit(1);
}
const container = createContainer(cfg);
const server = createApp(container).listen(cfg.port, () => logger.info({ port: cfg.port, chat: cfg.openai.chatModel, embeddings: cfg.openai.embeddingModel }, 'GPO RAG server listening'));
container.vectors.health().catch(() => logger.warn(`ChromaDB is not reachable at ${cfg.chroma.url}. Run "docker compose up -d".`));

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => server.close(() => process.exit(0)));
