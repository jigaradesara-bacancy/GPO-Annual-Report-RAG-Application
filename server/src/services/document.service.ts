import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DocumentRecord } from '../types/index.js';
import { notFound } from '../utils/errors.js';

/** Persistent document metadata (JSON file, atomically rewritten). */
export class DocumentStore {
  private readonly file: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(storageDir: string) {
    this.file = path.join(storageDir, 'documents.json');
  }

  /** Serialise read-modify-write cycles so concurrent requests cannot corrupt the file. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async readAll(): Promise<Record<string, DocumentRecord>> {
    try {
      return JSON.parse(await fs.readFile(this.file, 'utf8'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw err;
    }
  }

  private async writeAll(data: Record<string, DocumentRecord>) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2));
    await fs.rename(tmp, this.file);
  }

  list(): Promise<DocumentRecord[]> {
    return this.exclusive(async () => Object.values(await this.readAll()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  find(id: string): Promise<DocumentRecord | undefined> {
    return this.exclusive(async () => (await this.readAll())[id]);
  }

  async get(id: string): Promise<DocumentRecord> {
    const doc = await this.find(id);
    if (!doc) throw notFound('DOCUMENT_NOT_FOUND', `Document ${id} was not found.`);
    return doc;
  }

  save(doc: DocumentRecord): Promise<void> {
    return this.exclusive(async () => {
      const all = await this.readAll();
      all[doc.documentId] = { ...doc, updatedAt: new Date().toISOString() };
      await this.writeAll(all);
    });
  }

  update(id: string, patch: Partial<DocumentRecord>): Promise<DocumentRecord> {
    return this.exclusive(async () => {
      const all = await this.readAll();
      if (!all[id]) throw notFound('DOCUMENT_NOT_FOUND', `Document ${id} was not found.`);
      all[id] = { ...all[id], ...patch, updatedAt: new Date().toISOString() };
      await this.writeAll(all);
      return all[id];
    });
  }
}
