import { readFileSync, writeFileSync } from 'node:fs';
import { extractPages } from '../services/pdf-extract.js';

const [input, output] = process.argv.slice(2);
const pages = await extractPages(new Uint8Array(readFileSync(input)));
const out = pages.map((p) => `\n===== PAGE ${p.pageNumber} =====\n${p.text}`).join('');
writeFileSync(output, out);
console.log(`${pages.length} pages, ${out.length} chars`);
