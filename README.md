# GPO 2018 Annual Report Q&A (RAG)

A question-answering system over **one document**: the *GPO 2018 Annual Report* (mostly plain narrative text). Ask a question; the system finds the relevant passages and answers **only from them**, citing PDF page numbers.

```
React (Vite, Tailwind) ──► Express API ──► embeddings + chat model (OpenAI, or free local Ollama)
                                └────────► ChromaDB (persistent vectors, Docker volume)
```

**Pipeline:** PDF → text per page (`pdfjs-dist`) → clean → sentence-aware chunks (page numbers kept) → embeddings → ChromaDB → question embedding → nearest chunks → grounded answer → citations checked against what was retrieved.

## Pass bar and verified results

Correct = the exact fact from the surrounding paragraph, nothing added. Facts below were read from the PDF text; answers were produced by this system (local `nomic-embed-text` + `llama3.2:3b`) on the 2018 report:

| Question | Source says (PDF page) | System answer |
|---|---|---|
| How many depository libraries did GPO staff visit in FY 2018? | 166 libraries in 25 states (p. 5, p. 21) | "166 depository libraries in 25 states", cited pp. 21, 5 |
| What new digital system replaced FDsys, and when was it fully deployed? | govinfo; left beta Dec 2017; FDsys *scheduled* to be retired Dec 2018 (p. 5, p. 22) | "govinfo… December 2018", cited p. 22 |
| How much did GPO procure in printing and information products in FY 2018 for agencies? | "more than $375 million" (p. 5); "approximately $375.7 million" (pp. 17–18) | "Approximately $375.7 million", cited pp. 17–18 |
| (Absent) GPO revenue from selling cryptocurrency | not in report | Declined: `answerable: false`, no sources |

**Known weakness:** on question 2 the 3B model states the retirement as completed ("was fully deployed") while the report says it was *scheduled*. The prompt tells the model to keep such qualifiers, but small models don't always obey; a larger model (`qwen2.5:7b`, or OpenAI) follows it better. Always check important answers against the cited page.

> **Page numbers** are PDF page indexes (1-based), not the printed folios.

## Prerequisites
Node.js 20+, Docker (ChromaDB), and either an OpenAI API key **or** free local models via Ollama.

## Setup
```bash
cp .env.example .env            # choose OpenAI or Ollama settings (see below)
npm run install:all
docker compose up -d            # ChromaDB on :8000 (data persists in a Docker volume)
npm run dev:server              # API  http://localhost:5001
npm run dev:client              # UI   http://localhost:5173
```
Open the UI and click **Ingest GPO 2018 Annual Report** (downloads the PDF from gpo.gov, or uses `data/samples/gpo-annual-report-2018.pdf` if present), then ask questions. **Upload a different PDF** works too (text-based PDFs only). If the download fails you get an explicit error and can upload the file yourself; no other document is substituted.

Port **5001** is used because macOS AirPlay Receiver occupies 5000.

### Free local setup (Ollama)
```bash
brew install ollama && OLLAMA_CONTEXT_LENGTH=8192 ollama serve   # keep running
ollama pull nomic-embed-text && ollama pull llama3.2:3b
```
`.env` (leave `OPENAI_API_KEY` empty):
```
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_EMBEDDING_MODEL=nomic-embed-text
OPENAI_CHAT_MODEL=llama3.2:3b
CHUNK_SIZE_TOKENS=400
CHUNK_OVERLAP_TOKENS=60
MAX_CONTEXT_TOKENS=3000
OPENAI_TIMEOUT_MS=300000
EMBEDDING_BATCH_SIZE=8
OPENAI_MAX_RETRIES=1
```
CPU-only: ingestion takes ~1 min; each answer ~1 min. For OpenAI set `OPENAI_API_KEY` and the model names instead (defaults: `text-embedding-3-small`, `gpt-4o-mini`).

All settings are validated at startup; see [.env.example](.env.example). Defaults are starting points, not tuned values (`RETRIEVAL_MIN_SIMILARITY` especially: with `nomic-embed-text` relevant and irrelevant chunks both score high, so declining unanswerable questions relies mainly on the model).

## API
Errors are `{"error": {"code", "message"}}`.

| Method | Path | |
|---|---|---|
| GET | `/api/health` | Chroma and model status |
| POST | `/api/documents/ingest-sample` | Ingest the configured report |
| POST | `/api/documents/upload` | multipart field `file` |
| GET | `/api/documents`, `/api/documents/:id` | Status, page and chunk counts |
| POST | `/api/chat/ask` | `{"question": "...", "documentId": "..."}` (`documentId` optional if exactly one document is ready) |

```bash
curl -X POST localhost:5001/api/chat/ask -H 'content-type: application/json' \
  -d '{"question":"How many depository libraries did GPO staff visit in FY 2018?"}'
```
Response: `answer`, `answerable` (false when the report doesn't contain the answer), `sources[]` (page numbers, chunk ID, excerpt, similarity), `warnings[]`, `retrieval` (chunks retrieved/sent, models), `latencyMs`.

## How answers stay grounded
- No relevant chunks retrieved → the model is not called; the answer says it wasn't found.
- Excerpts are sent as delimited, escaped data with short IDs (`E1`, `E2`…); instructions live only in the system message. Citations are built only from chunks that were sent, and invented IDs are dropped (with a warning).
- Ingestion refuses scanned PDFs (`OCR_REQUIRED`) instead of reporting false success, and deletes partial vectors on failure. Embedding model is stored with the document; a mismatch returns `EMBEDDING_MODEL_MISMATCH` (ingest again). Re-ingesting the same file creates no duplicate chunks.
- Upload checks (MIME, `%PDF-` signature, size), rate limits, request timeouts, one ingestion at a time, no secrets in logs.

## Tests
`npm test` (Vitest + Supertest for the server, React Testing Library for the client) and `npm run typecheck`. API tests use in-memory fakes for OpenAI/Chroma only inside test fixtures; `vector-store.integration.test.ts` uses a real ChromaDB (skipped if not running).

## Troubleshooting
- **`Invalid environment configuration`**: set `OPENAI_API_KEY` or `OPENAI_BASE_URL` in the repo-root `.env`.
- **`chroma: unreachable` / `ChromaConnectionError`**: start Docker Desktop, then `docker compose up -d` (needed after every reboot).
- **`LLM_UNREACHABLE`**: Ollama isn't running (`ollama serve`) or `OPENAI_BASE_URL` is wrong.
- **`LLM_TIMEOUT`**: CPU models are slow; use the timeout/batch settings above.
- **`OPENAI_QUOTA_EXHAUSTED`**: the OpenAI account has no credits; add billing or use Ollama.
- **`OCR_REQUIRED`**: scanned PDF; OCR it first (e.g. `ocrmypdf`).
- **`EMBEDDING_MODEL_MISMATCH`**: you changed the embedding model; click Ingest again.
- **Wrong document ingested**: check `SAMPLE_*` in `.env` (an old `.env` can override the defaults).
- **Reset**: `docker compose down -v` and delete `server/storage`.

## Limitations
No OCR; tables become flowing text; no authentication (local practice project); stateless chat (no follow-up memory); small local models cite and phrase less reliably than hosted ones; document metadata is a JSON file.
