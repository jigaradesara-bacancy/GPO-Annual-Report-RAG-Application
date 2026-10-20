import { useRef, useState } from 'react';
import { api } from '../services/api';
import type { DocumentRecord } from '../types';
import { ErrorBox, Spinner } from './StatusBadge';

interface Props {
  documents: DocumentRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChanged: () => Promise<void>;
}

export function DocumentPanel({ documents, selectedId, onSelect, onChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Success is only shown after the backend confirms: the refreshed document status is the source of truth.
  async function run(label: string, task: () => Promise<DocumentRecord>) {
    setBusy(label);
    setError(null);
    try {
      const doc = await task();
      await onChanged();
      onSelect(doc.documentId);
    } catch (e) {
      setError((e as Error).message);
      await onChanged();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Document" className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={!!busy} onClick={() => void run('Ingesting the GPO 2018 Annual Report (extracting, embedding)…', api.ingestSample)} className="rounded bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
          Ingest GPO 2018 Annual Report
        </button>
        <label className="cursor-pointer rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-100 aria-disabled:opacity-50" aria-disabled={!!busy}>
          Upload a different PDF
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            disabled={!!busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void run('Uploading, extracting, embedding…', () => api.uploadDocument(file));
              if (fileRef.current) fileRef.current.value = '';
            }}
          />
        </label>
        {documents.length > 1 && (
          <select aria-label="Document" value={selectedId ?? ''} onChange={(e) => onSelect(e.target.value)} className="rounded border border-slate-300 bg-white px-2 py-2 text-sm">
            {documents.map((d) => (
              <option key={d.documentId} value={d.documentId}>
                {d.documentName} ({d.status})
              </option>
            ))}
          </select>
        )}
        {busy && <Spinner label={busy} />}
      </div>
      {error && <ErrorBox message={error} />}
    </section>
  );
}
