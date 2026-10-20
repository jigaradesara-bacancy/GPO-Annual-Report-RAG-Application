import type { IngestionStatus } from '../types';

const STYLES: Record<IngestionStatus, string> = {
  ready: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  pending: 'bg-slate-100 text-slate-700',
  extracting: 'bg-amber-100 text-amber-800',
  chunking: 'bg-amber-100 text-amber-800',
  embedding: 'bg-amber-100 text-amber-800',
};

export function StatusBadge({ status }: { status: IngestionStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}>{status}</span>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-slate-600">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
      {label}
    </span>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start justify-between gap-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <span>{message}</span>
      {onRetry && (
        <button onClick={onRetry} className="shrink-0 rounded border border-red-300 bg-white px-2 py-0.5 hover:bg-red-100">
          Retry
        </button>
      )}
    </div>
  );
}
