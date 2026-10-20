import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import type { DocumentRecord } from '../types';

const KEY = 'gpo-rag:selectedDocument';
const read = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

export function useDocuments() {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(read());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setDocuments(await api.listDocuments());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Fall back to the first ready document when nothing (valid) is selected.
  useEffect(() => {
    if (!documents.length) return;
    if (!selectedId || !documents.some((d) => d.documentId === selectedId)) {
      setSelectedId((documents.find((d) => d.status === 'ready') ?? documents[0]).documentId);
    }
  }, [documents, selectedId]);

  const select = (id: string) => {
    setSelectedId(id);
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* ignore */
    }
  };

  const selected = documents.find((d) => d.documentId === selectedId) ?? null;
  return { documents, selected, select, refresh, loading, error };
}
