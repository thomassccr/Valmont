import { normalize, retry } from '@valmont/kernel';
import { LLMError, type EmbeddingProvider } from '../types.js';

/**
 * Embeddings OpenAI. Anthropic ne propose pas d'embeddings ; `text-embedding-3-small`
 * offre aujourd'hui le meilleur rapport qualité/prix pour une mémoire personnelle
 * (quelques centimes pour des années de souvenirs).
 *
 * Appel HTTP direct plutôt que le SDK : une seule route est utilisée, et on
 * évite une dépendance de plus dans un projet censé durer.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai';
  readonly model: string;
  readonly dimensions: number;

  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;

  constructor(options: {
    apiKey?: string;
    model?: string;
    dimensions?: number;
    baseUrl?: string;
  }) {
    this.apiKey = options.apiKey ?? process.env['OPENAI_API_KEY'];
    this.model = options.model ?? 'text-embedding-3-small';
    this.dimensions = options.dimensions ?? 1536;
    this.baseUrl = options.baseUrl ?? 'https://api.openai.com/v1';
  }

  health(): { ok: boolean; detail?: string } {
    return this.apiKey
      ? { ok: true, detail: this.model }
      : { ok: false, detail: 'OPENAI_API_KEY absente' };
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    if (!this.apiKey) throw new LLMError('OPENAI_API_KEY absente');

    return retry(
      async () => {
        const response = await fetch(`${this.baseUrl}/embeddings`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            input: texts,
            dimensions: this.dimensions,
          }),
          ...(signal ? { signal } : {}),
        });

        if (!response.ok) {
          throw new LLMError(
            `embeddings OpenAI : ${response.status} ${await response.text()}`,
            undefined,
            response.status === 429 || response.status >= 500,
          );
        }

        const payload = (await response.json()) as {
          data: Array<{ index: number; embedding: number[] }>;
        };

        // L'API ne garantit pas l'ordre : on réindexe explicitement.
        const out = new Array<Float32Array>(texts.length);
        for (const item of payload.data) {
          out[item.index] = normalize(Float32Array.from(item.embedding));
        }
        return out;
      },
      { attempts: 4, ...(signal ? { signal } : {}) },
    );
  }
}
