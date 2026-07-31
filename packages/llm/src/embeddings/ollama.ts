import { normalize, retry } from '@valmont/kernel';
import { LLMError, type EmbeddingProvider } from '../types.js';

/**
 * Embeddings locaux via Ollama. C'est l'option à privilégier à terme :
 * la mémoire d'une vie privée n'a aucune raison de transiter par un tiers.
 * Elle demande simplement `ollama pull nomic-embed-text`.
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'ollama';
  readonly model: string;
  readonly dimensions: number;

  private readonly baseUrl: string;
  private reachable = true;

  constructor(options: { model?: string; baseUrl?: string; dimensions?: number }) {
    this.model = options.model ?? 'nomic-embed-text';
    this.baseUrl = options.baseUrl ?? 'http://127.0.0.1:11434';
    this.dimensions = options.dimensions ?? 768;
  }

  health(): { ok: boolean; detail?: string } {
    return this.reachable
      ? { ok: true, detail: `${this.model} @ ${this.baseUrl}` }
      : { ok: false, detail: `Ollama injoignable sur ${this.baseUrl}` };
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    if (texts.length === 0) return [];

    try {
      const vectors = await retry(
        async () => {
          const response = await fetch(`${this.baseUrl}/api/embed`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: this.model, input: texts }),
            ...(signal ? { signal } : {}),
          });

          if (!response.ok) {
            throw new LLMError(`embeddings Ollama : ${response.status}`, undefined, true);
          }

          const payload = (await response.json()) as { embeddings: number[][] };
          return payload.embeddings.map((vector) => normalize(Float32Array.from(vector)));
        },
        { attempts: 3, ...(signal ? { signal } : {}) },
      );

      this.reachable = true;
      return vectors;
    } catch (error) {
      this.reachable = false;
      throw error;
    }
  }
}
