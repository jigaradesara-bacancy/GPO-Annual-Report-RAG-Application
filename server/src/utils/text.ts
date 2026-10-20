import { encode } from 'gpt-tokenizer';

export const countTokens = (text: string): number => encode(text).length;

/**
 * Normalise whitespace without touching characters that matter in a report:
 * digits, $, %, parentheses, bullets, punctuation and line structure are kept.
 */
export function cleanText(raw: string): string {
  return raw
    .replace(/\u0000/g, '')
    .replace(/­/g, '') // soft hyphen
    .replace(/[   ]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
