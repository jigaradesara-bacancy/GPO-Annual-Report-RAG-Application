import type { DocumentRecord } from '../types';
import { StatusBadge } from './StatusBadge';

const Stat = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="rounded border border-slate-200 bg-white p-3">
    <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
    <div className="mt-1 text-lg font-semibold">{value}</div>
  </div>
);

export function Dashboard({ doc }: { doc: DocumentRecord | null }) {
  if (!doc) return <p className="rounded border border-dashed border-slate-300 p-4 text-sm text-slate-600">No document selected. Ingest the GPO 2018 Annual Report below.</p>;
  const vectors = doc.status === 'ready' ? `Stored in ChromaDB (${doc.chunkCount} vectors)` : doc.status === 'failed' ? 'Not stored' : 'In progress…';
  return (
    <section aria-label="Selected document" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{doc.documentName}</h2>
        <StatusBadge status={doc.status} />
      </div>
      {doc.errorMessage && <p className="rounded bg-red-50 p-2 text-sm text-red-800">{doc.errorMessage}</p>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Extracted pages" value={doc.pageCount ?? '—'} />
        <Stat label="Chunks" value={doc.chunkCount ?? '—'} />
        <Stat label="Embedding model" value={<span className="text-sm">{doc.embeddingModel ?? '—'}</span>} />
        <Stat label="Vector storage" value={<span className="text-sm">{vectors}</span>} />
        <Stat label="Last ingestion" value={<span className="text-sm">{doc.lastIngestedAt ? new Date(doc.lastIngestedAt).toLocaleString() : '—'}</span>} />
        <Stat label="Document ID" value={<span className="font-mono text-sm">{doc.documentId}</span>} />
      </div>
    </section>
  );
}
