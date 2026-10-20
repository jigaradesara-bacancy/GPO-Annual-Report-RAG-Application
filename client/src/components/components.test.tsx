import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel } from './ChatPanel';
import { DocumentPanel } from './DocumentPanel';
import { api } from '../services/api';
import type { AnswerResult, DocumentRecord } from '../types';

vi.mock('../services/api', () => ({ api: { ask: vi.fn(), ingestSample: vi.fn(), uploadDocument: vi.fn() } }));

const retrieval = { chunksRetrieved: 2, chunksSentToModel: 2, topK: 5, minSimilarity: 0.2, embeddingModel: 'm', chatModel: 'c', chunks: [] };
const base: Omit<AnswerResult, 'answer' | 'answerable' | 'sources'> = { warnings: [], retrieval, latencyMs: { retrieval: 10, generation: 20, total: 30 } };
const doc: DocumentRecord = { documentId: 'abcdef0123456789', documentName: 'GPO Annual Report 2025', originalFileName: 'a.pdf', fileSizeBytes: 1048576, status: 'ready', pageCount: 98, chunkCount: 58, createdAt: '', updatedAt: '' };

beforeEach(() => vi.resetAllMocks());

describe('ChatPanel', () => {
  it('shows the answer with expandable page-cited sources', async () => {
    vi.mocked(api.ask).mockResolvedValue({ ...base, answer: 'Net income was $32.8 million (p. 39).', answerable: true, sources: [{ documentId: 'd', documentName: 'GPO Annual Report 2025', pageNumbers: [39], chunkId: 'd-c0030', excerpt: 'net income of $32.8 million', similarity: 0.6 }] });
    render(<ChatPanel documentId="abcdef0123456789" />);
    await userEvent.type(screen.getByLabelText('Question'), 'What was net income?');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText(/Net income was \$32.8 million/)).toBeInTheDocument();
    expect(screen.getByText(/p\. 39/, { selector: 'summary' })).toBeInTheDocument();
    expect(screen.getByText('net income of $32.8 million')).toBeInTheDocument();
    expect(api.ask).toHaveBeenCalledWith('What was net income?', 'abcdef0123456789');
  });

  it('clearly flags answers that were not found', async () => {
    vi.mocked(api.ask).mockResolvedValue({ ...base, answer: 'The answer could not be found in the retrieved report content.', answerable: false, sources: [] });
    render(<ChatPanel documentId="x" />);
    await userEvent.type(screen.getByLabelText('Question'), 'Mars colony budget?');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText('Not found in the retrieved report content')).toBeInTheDocument();
  });

  it('shows errors and retries', async () => {
    vi.mocked(api.ask).mockRejectedValueOnce(new Error('OpenAI rate limit')).mockResolvedValueOnce({ ...base, answer: 'ok now', answerable: true, sources: [] });
    render(<ChatPanel documentId="x" />);
    await userEvent.type(screen.getByLabelText('Question'), 'anything?');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('OpenAI rate limit');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('ok now')).toBeInTheDocument();
  });

  it('is disabled without a ready document', () => {
    render(<ChatPanel documentId={null} disabledReason="Select or ingest a document first" />);
    expect(screen.getByLabelText('Question')).toBeDisabled();
  });
});

describe('DocumentPanel', () => {
  it('shows backend ingestion errors instead of success', async () => {
    vi.mocked(api.ingestSample).mockRejectedValue(new Error('The configured report could not be downloaded'));
    render(<DocumentPanel documents={[]} selectedId={null} onSelect={vi.fn()} onChanged={vi.fn().mockResolvedValue(undefined)} />);
    await userEvent.click(screen.getByRole('button', { name: /Ingest GPO 2018/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be downloaded');
  });

  it('selects the ingested document only after the backend confirms', async () => {
    vi.mocked(api.ingestSample).mockResolvedValue(doc);
    const onSelect = vi.fn();
    const onChanged = vi.fn().mockResolvedValue(undefined);
    render(<DocumentPanel documents={[]} selectedId={null} onSelect={onSelect} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole('button', { name: /Ingest GPO 2018/ }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(doc.documentId));
    expect(onChanged).toHaveBeenCalled();
  });
});
