import { useState } from 'react';
import { api } from '../services/api';
import type { AnswerResult } from '../types';
import { ErrorBox, Spinner } from './StatusBadge';
import { SourceList } from './SourceList';

interface Turn {
  id: number;
  question: string;
  result?: AnswerResult;
  error?: string;
  pending: boolean;
}

export function ChatPanel({ documentId, disabledReason }: { documentId: string | null; disabledReason?: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');

  async function ask(question: string, replaceId?: number) {
    if (!documentId) return;
    const id = replaceId ?? Date.now();
    setTurns((t) => (replaceId ? t.map((x) => (x.id === id ? { ...x, pending: true, error: undefined } : x)) : [...t, { id, question, pending: true }]));
    try {
      const result = await api.ask(question, documentId);
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, pending: false, result } : x)));
    } catch (e) {
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, pending: false, error: (e as Error).message } : x)));
    }
  }

  const disabled = !documentId || !!disabledReason;
  return (
    <section aria-label="Ask a question" className="space-y-4">
      <div className="space-y-4">
        {turns.map((t) => (
          <div key={t.id} className="space-y-2">
            <div className="ml-auto w-fit max-w-[90%] rounded-lg bg-slate-800 px-3 py-2 text-sm text-white">{t.question}</div>
            <div className="max-w-[95%] rounded-lg border border-slate-200 bg-white p-3">
              {t.pending && <Spinner label="Retrieving passages and generating an answer…" />}
              {t.error && <ErrorBox message={t.error} onRetry={() => void ask(t.question, t.id)} />}
              {t.result && (
                <>
                  {!t.result.answerable && <div className="mb-2 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Not found in the retrieved report content</div>}
                  <p className="whitespace-pre-wrap text-sm">{t.result.answer}</p>
                  {t.result.warnings.map((w) => (
                    <p key={w} className="mt-2 text-xs text-amber-800">⚠ {w}</p>
                  ))}
                  <SourceList sources={t.result.sources} />
                  <p className="mt-2 text-xs text-slate-500">
                    {t.result.retrieval.chunksRetrieved} chunks retrieved, {t.result.retrieval.chunksSentToModel} sent to {t.result.retrieval.chatModel} · {(t.result.latencyMs.total / 1000).toFixed(1)}s
                  </p>
                </>
              )}
            </div>
          </div>
        ))}
        {!turns.length && <p className="text-sm text-slate-600">Ask something about the selected report, e.g. “What are the primary responsibilities of the GPO?”</p>}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const q = input.trim();
          if (q.length < 3 || disabled) return;
          setInput('');
          void ask(q);
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} disabled={disabled} maxLength={1000} placeholder={disabledReason ?? 'Ask a question about the report…'} aria-label="Question" className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100" />
        <button type="submit" disabled={disabled || input.trim().length < 3} className="rounded bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50">
          Ask
        </button>
      </form>
    </section>
  );
}
