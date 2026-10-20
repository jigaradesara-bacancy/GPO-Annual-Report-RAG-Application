import pino from 'pino';

/** Never log request bodies, headers, or API keys; redact defensively anyway. */
export const logger = pino({
  level: process.env.NODE_ENV === 'test' ? 'silent' : (process.env.LOG_LEVEL ?? 'info'),
  redact: ['*.apiKey', '*.authorization', 'req.headers.authorization', 'OPENAI_API_KEY'],
});
