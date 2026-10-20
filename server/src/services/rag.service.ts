import type { AnswerResult } from '../types/index.js';
import type { GenerationService } from './generation.service.js';
import type { RetrievalService } from './retrieval.service.js';

/** Retrieval and generation stay independent; this only chains them. */
export class RagService {
  constructor(
    readonly retrieval: RetrievalService,
    readonly generation: GenerationService,
  ) {}

  async ask(question: string, documentId?: string): Promise<AnswerResult> {
    const id = await this.retrieval.resolveDocumentId(documentId);
    const retrieved = await this.retrieval.search(question, id);
    return this.generation.generate(retrieved);
  }
}
