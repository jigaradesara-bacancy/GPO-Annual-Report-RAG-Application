import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

// The single .env lives at the repository root (next to .env.example).
dotenv.config({ path: path.resolve(import.meta.dirname, '..', '..', '..', '.env'), quiet: true });

const int = (def: number) => z.coerce.number().int().positive().default(def);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: int(5001),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),

  // Required for api.openai.com. Optional when OPENAI_BASE_URL points at an OpenAI-compatible server (e.g. local Ollama).
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().optional(),
  OPENAI_EMBEDDING_MODEL: z.string().min(1).default('text-embedding-3-small'),
  OPENAI_CHAT_MODEL: z.string().min(1).default('gpt-4o-mini'),
  OPENAI_TIMEOUT_MS: int(60_000),
  OPENAI_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(4),
  EMBEDDING_BATCH_SIZE: int(64),

  CHROMA_URL: z.string().url().default('http://localhost:8000'),
  CHROMA_COLLECTION_NAME: z.string().min(1).default('gpo_annual_report'),

  MAX_UPLOAD_SIZE_MB: int(25),
  CHUNK_SIZE_TOKENS: int(800),
  CHUNK_OVERLAP_TOKENS: z.coerce.number().int().min(0).default(120),
  RETRIEVAL_TOP_K: int(5),
  RETRIEVAL_MIN_SIMILARITY: z.coerce.number().min(-1).max(1).default(0.2),
  MAX_CONTEXT_TOKENS: int(6000),
  MAX_QUESTION_CHARS: int(1000),
  MIN_EXTRACTED_CHARS_PER_PAGE: int(100),

  SAMPLE_PDF_URL: z
    .string()
    .url()
    .default('https://www.gpo.gov/docs/default-source/news-content-pdf-files/2018_annualreport.pdf'),
  SAMPLE_PDF_PATH: z.string().default('data/samples/gpo-annual-report-2018.pdf'),
  SAMPLE_DOCUMENT_NAME: z.string().default('GPO Annual Report 2018'),
  STORAGE_DIR: z.string().default('server/storage'),
});

export type Config = ReturnType<typeof buildConfig>;

export function buildConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  if (!e.OPENAI_API_KEY && !e.OPENAI_BASE_URL) {
    throw new Error('Invalid environment configuration:\n  - OPENAI_API_KEY: is required (set it in .env, see .env.example), or set OPENAI_BASE_URL to use a free local model such as Ollama');
  }
  if (e.CHUNK_OVERLAP_TOKENS >= e.CHUNK_SIZE_TOKENS) {
    throw new Error('Invalid environment configuration: CHUNK_OVERLAP_TOKENS must be smaller than CHUNK_SIZE_TOKENS');
  }
  // The repo root is the parent of server/ regardless of where the process is started.
  const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
  const resolve = (p: string) => (path.isAbsolute(p) ? p : path.resolve(repoRoot, p));
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    clientUrl: e.CLIENT_URL,
    openai: {
      apiKey: e.OPENAI_API_KEY || 'not-needed', // local servers ignore the key, but the SDK requires a value
      baseURL: e.OPENAI_BASE_URL,
      embeddingModel: e.OPENAI_EMBEDDING_MODEL,
      chatModel: e.OPENAI_CHAT_MODEL,
      timeoutMs: e.OPENAI_TIMEOUT_MS,
      maxRetries: e.OPENAI_MAX_RETRIES,
      batchSize: e.EMBEDDING_BATCH_SIZE,
    },
    chroma: { url: e.CHROMA_URL, collectionBase: e.CHROMA_COLLECTION_NAME },
    maxUploadBytes: e.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
    chunking: { sizeTokens: e.CHUNK_SIZE_TOKENS, overlapTokens: e.CHUNK_OVERLAP_TOKENS },
    retrieval: { topK: e.RETRIEVAL_TOP_K, minSimilarity: e.RETRIEVAL_MIN_SIMILARITY },
    generation: { maxContextTokens: e.MAX_CONTEXT_TOKENS, maxQuestionChars: e.MAX_QUESTION_CHARS },
    minExtractedCharsPerPage: e.MIN_EXTRACTED_CHARS_PER_PAGE,
    sample: {
      url: e.SAMPLE_PDF_URL,
      path: resolve(e.SAMPLE_PDF_PATH),
      documentName: e.SAMPLE_DOCUMENT_NAME,
    },
    storageDir: resolve(e.STORAGE_DIR),
  };
}
