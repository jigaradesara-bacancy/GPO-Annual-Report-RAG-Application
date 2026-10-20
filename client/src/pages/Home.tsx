import { ChatPanel } from '../components/ChatPanel';
import { Dashboard } from '../components/Dashboard';
import { DocumentPanel } from '../components/DocumentPanel';
import { ErrorBox } from '../components/StatusBadge';
import { useDocuments } from '../hooks/useDocuments';

export default function Home() {
  const { documents, selected, select, refresh, loading, error } = useDocuments();
  const ready = selected?.status === 'ready';
  const reason = !selected ? 'Ingest the report first' : ready ? undefined : `Document is "${selected.status}" and cannot be queried`;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <header>
        <h1 className="text-2xl font-bold">GPO Annual Report Assistant</h1>
        <p className="text-sm text-slate-600">Ask questions about the GPO 2018 Annual Report. Answers come only from the report text and cite PDF page numbers.</p>
      </header>
      {error && <ErrorBox message={error} onRetry={() => void refresh()} />}
      {loading ? <p className="text-sm text-slate-500">Loading…</p> : <Dashboard doc={selected} />}
      <DocumentPanel documents={documents} selectedId={selected?.documentId ?? null} onSelect={select} onChanged={refresh} />
      <ChatPanel key={selected?.documentId} documentId={ready ? selected!.documentId : null} disabledReason={reason} />
    </div>
  );
}
