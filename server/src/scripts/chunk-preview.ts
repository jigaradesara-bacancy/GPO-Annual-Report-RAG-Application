import { readFileSync } from 'node:fs';
import { extractPages } from '../services/pdf-extract.js';
import { chunkPages } from '../services/chunking.service.js';

const pages = await extractPages(new Uint8Array(readFileSync(process.argv[2])));
const chunks = chunkPages(pages, { documentId: 'preview', documentName: 'preview' }, { sizeTokens: 800, overlapTokens: 120 });
const toks = chunks.map((c) => c.tokenCount);
console.log({ chunks: chunks.length, maxTokens: Math.max(...toks), minTokens: Math.min(...toks) });
for (const i of [0, 5, 30]) console.log(`\n--- ${chunks[i].chunkId} pages=${chunks[i].pageNumbers} section=${chunks[i].section} tokens=${chunks[i].tokenCount}\n${chunks[i].text.slice(0, 500)}`);
