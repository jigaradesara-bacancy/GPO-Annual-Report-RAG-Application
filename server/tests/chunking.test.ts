import { describe, expect, it } from 'vitest';
import { chunkPages } from '../src/services/chunking.service.js';
import { cleanText, countTokens } from '../src/utils/text.js';

const doc = { documentId: 'doc1', documentName: 'Report' };
const sentence = (n: number) => `Sentence number ${n} reports revenue of $${n}.5 million (up 3%).`;

describe('cleanText', () => {
  it('collapses whitespace but keeps figures and symbols', () => {
    expect(cleanText('Revenue   was  $1,329.7 million (8.7%)  \n\n\n\n ■ item')).toBe('Revenue was $1,329.7 million (8.7%)\n\n■ item');
  });
});

describe('chunkPages', () => {
  const pages = [1, 2, 3, 4].map((p) => ({ pageNumber: p, text: Array.from({ length: 12 }, (_, i) => sentence(p * 100 + i)).join(' ') }));
  const chunks = chunkPages(pages, doc, { sizeTokens: 100, overlapTokens: 20 });

  it('respects the size limit (allowing small tokenizer rounding) and keeps whole sentences', () => {
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      expect(c.tokenCount).toBeLessThanOrEqual(110);
      expect(c.text.trim().endsWith('.')).toBe(true);
    }
  });

  it('tracks page numbers, including chunks that span pages', () => {
    expect(chunks[0].pageNumbers[0]).toBe(1);
    expect(chunks.some((c) => c.pageNumbers.length > 1)).toBe(true);
    for (const c of chunks) expect([...c.pageNumbers]).toEqual([...c.pageNumbers].sort((a, b) => a - b));
  });

  it('has stable, unique IDs and document metadata', () => {
    const again = chunkPages(pages, doc, { sizeTokens: 100, overlapTokens: 20 });
    expect(again.map((c) => c.chunkId)).toEqual(chunks.map((c) => c.chunkId));
    expect(new Set(chunks.map((c) => c.chunkId)).size).toBe(chunks.length);
    expect(chunks.every((c) => c.documentId === 'doc1' && c.documentName === 'Report')).toBe(true);
  });

  it('overlaps consecutive chunks', () => {
    const lastSentenceOfFirst = chunks[0].text.split('\n').at(-1)!;
    expect(chunks[1].text.includes(lastSentenceOfFirst)).toBe(true);
  });

  it('splits a single sentence longer than the chunk size', () => {
    const long = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ') + '.';
    const out = chunkPages([{ pageNumber: 7, text: long }], doc, { sizeTokens: 100, overlapTokens: 10 });
    expect(out.length).toBeGreaterThan(2);
    expect(out.every((c) => countTokens(c.text) <= 105 && c.pageNumbers[0] === 7)).toBe(true);
  });

  it('drops running page headers and records section headings', () => {
    const text = 'U . S . G O V E R N M E N T P U B L I S H I N G O F F I C E 2 0 2 5\nGPO FINANCES\nRevenue was high. Expenses were lower.';
    const [c] = chunkPages([{ pageNumber: 1, text }], doc, { sizeTokens: 100, overlapTokens: 10 });
    expect(c.text).not.toContain('G O V E R N');
    expect(c.section).toBe('GPO FINANCES');
  });

  it('rejects overlap >= size', () => {
    expect(() => chunkPages(pages, doc, { sizeTokens: 50, overlapTokens: 50 })).toThrow();
  });
});
