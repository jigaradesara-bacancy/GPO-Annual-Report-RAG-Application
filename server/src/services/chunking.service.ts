import { encode, decode } from 'gpt-tokenizer';
import type { Chunk, PageText } from '../types/index.js';
import { cleanText, countTokens } from '../utils/text.js';

export interface ChunkingOptions {
  sizeTokens: number;
  overlapTokens: number;
}

export interface DocumentRef {
  documentId: string;
  documentName: string;
}

interface Unit {
  text: string;
  page: number;
  tokens: number;
  section?: string;
}

/** Running page headers such as "U . S . G O V E R N M E N T ..." (letters separated by spaces). */
const SPACED_LETTERS = /(?:\b\S ){6,}/;
const BULLET = /^[■•▪●◦-]\s/;

function isHeading(line: string): boolean {
  const t = line.trim();
  if (t.length < 3 || t.length > 90) return false;
  if (/^Goal \d\s*[—–-][A-Za-z ,&]+\.?$/.test(t)) return true;
  const letters = t.replace(/[^A-Za-z]/g, '');
  const upper = t.replace(/[^A-Z]/g, '');
  return letters.length >= 3 && upper.length / letters.length > 0.8 && !/[.:;,]$/.test(t) && !/\.{4,}/.test(t);
}

/** Turn one page into sentence-level units, tracking the latest section heading. */
function pageToUnits(page: PageText, startSection: string | undefined): { units: Unit[]; section?: string } {
  const lines = cleanText(page.text)
    .split('\n')
    .filter((l) => !SPACED_LETTERS.test(l));

  const units: Unit[] = [];
  let section = startSection;
  let para = '';

  const pushText = (text: string) => {
    // Split a paragraph into sentences without breaking decimals ($1.3), abbreviations like "U.S." or "No."
    const sentences = text.split(/(?<=[.!?”"])\s+(?=[A-Z“"(■•$\d])(?<!\b(?:U\.S|Mr|Mrs|Ms|Dr|No|St|Inc|Co|vs|Jr|Sr)\.\s)/);
    for (const s of sentences) {
      const t = s.trim();
      if (t) units.push({ text: t, page: page.pageNumber, tokens: countTokens(t), section });
    }
  };
  const flush = () => {
    if (para.trim()) pushText(para.trim());
    para = '';
  };

  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      flush();
    } else if (isHeading(t)) {
      flush();
      section = t;
      units.push({ text: t, page: page.pageNumber, tokens: countTokens(t), section });
    } else if (BULLET.test(t)) {
      flush();
      para = t;
    } else {
      // Rejoin hard line wraps and hyphenated line breaks.
      para = para.endsWith('-') && !para.endsWith(' -') ? para.slice(0, -1) + t : para ? `${para} ${t}` : t;
    }
  }
  flush();
  return { units, section };
}

/** Split a single over-long unit into token windows so it never exceeds the chunk size. */
function splitOversized(unit: Unit, size: number): Unit[] {
  if (unit.tokens <= size) return [unit];
  const tokens = encode(unit.text);
  const parts: Unit[] = [];
  for (let i = 0; i < tokens.length; i += size) {
    const text = decode(tokens.slice(i, i + size)).trim();
    if (text) parts.push({ ...unit, text, tokens: Math.min(size, tokens.length - i) });
  }
  return parts;
}

export function chunkPages(pages: PageText[], doc: DocumentRef, opts: ChunkingOptions): Chunk[] {
  if (opts.overlapTokens >= opts.sizeTokens) throw new Error('overlapTokens must be smaller than sizeTokens');

  const units: Unit[] = [];
  let section: string | undefined;
  for (const page of pages) {
    const r = pageToUnits(page, section);
    section = r.section;
    for (const u of r.units) units.push(...splitOversized(u, opts.sizeTokens));
  }

  const chunks: Chunk[] = [];
  let current: Unit[] = [];
  let currentTokens = 0;

  const emit = () => {
    if (!current.length) return;
    const text = current.map((u) => u.text).join('\n');
    const index = chunks.length;
    chunks.push({
      chunkId: `${doc.documentId}-c${String(index).padStart(4, '0')}`,
      documentId: doc.documentId,
      documentName: doc.documentName,
      chunkIndex: index,
      pageNumbers: [...new Set(current.map((u) => u.page))].sort((a, b) => a - b),
      section: current[0].section,
      text,
      tokenCount: countTokens(text),
    });
  };

  for (const unit of units) {
    if (current.length && currentTokens + unit.tokens > opts.sizeTokens) {
      emit();
      // Carry trailing units forward as overlap (whole sentences only).
      const carry: Unit[] = [];
      let carried = 0;
      for (let i = current.length - 1; i >= 0; i--) {
        if (carried + current[i].tokens > opts.overlapTokens) break;
        carry.unshift(current[i]);
        carried += current[i].tokens;
      }
      current = carry;
      currentTokens = carried;
    }
    current.push(unit);
    currentTokens += unit.tokens;
  }
  // Avoid a final chunk that is nothing but overlap from the previous one.
  const lastEmitted = chunks[chunks.length - 1];
  if (current.length && !(lastEmitted && current.every((u) => lastEmitted.text.includes(u.text)))) emit();
  return chunks;
}
