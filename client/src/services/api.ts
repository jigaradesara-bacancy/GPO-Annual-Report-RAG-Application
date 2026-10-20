import type { AnswerResult, DocumentRecord } from '../types';

const BASE = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, init);
  } catch {
    throw new ApiError('Cannot reach the backend. Is the server running on port 5001?', 'NETWORK', 0);
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(body?.error?.message ?? `Request failed (HTTP ${res.status})`, body?.error?.code ?? 'HTTP_ERROR', res.status);
  return body as T;
}

const json = (method: string, data?: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });

export const api = {
  listDocuments: () => request<{ documents: DocumentRecord[] }>('/documents').then((r) => r.documents),
  uploadDocument: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{ document: DocumentRecord }>('/documents/upload', { method: 'POST', body: form }).then((r) => r.document);
  },
  ingestSample: () => request<{ document: DocumentRecord }>('/documents/ingest-sample', json('POST')).then((r) => r.document),
  ask: (question: string, documentId: string) => request<AnswerResult>('/chat/ask', json('POST', { question, documentId })),
};
