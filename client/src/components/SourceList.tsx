import type { SourceCitation } from '../types';

export const pageLabel = (pages: number[]) => (pages.length === 1 ? `p. ${pages[0]}` : `pp. ${pages.join(', ')}`);

export function SourceList({ sources }: { sources: SourceCitation[] }) {
  if (!sources.length) return null;
  return (
    <div className="mt-3 space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sources (PDF page numbers)</div>
      {sources.map((s) => (
        <details key={s.chunkId} className="rounded border border-slate-200 bg-slate-50 p-2 text-sm">
          <summary className="cursor-pointer font-medium">
            {s.documentName}, {pageLabel(s.pageNumbers)} <span className="font-normal text-slate-500">· {s.chunkId}</span>
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-slate-700">{s.excerpt}</p>
        </details>
      ))}
    </div>
  );
}
