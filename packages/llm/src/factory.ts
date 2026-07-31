import type { ValmontConfig } from '@valmont/kernel';
import { AnthropicProvider } from './anthropic.js';
import { MockProvider } from './mock.js';
import { LocalEmbeddingProvider } from './embeddings/local.js';
import { OllamaEmbeddingProvider } from './embeddings/ollama.js';
import { OpenAIEmbeddingProvider } from './embeddings/openai.js';
import type { EmbeddingProvider, LLMProvider } from './types.js';

/**
 * Sélection des fournisseurs à partir de la configuration.
 *
 * Règle de conception : **Valmont démarre toujours**. Une clé manquante fait
 * tomber en mode dégradé et le dit clairement ; elle n'empêche jamais le
 * lancement. Une IA personnelle qui refuse d'ouvrir parce qu'un service tiers
 * est indisponible n'est pas une présence, c'est un client d'API.
 */
export function createLLMProvider(config: ValmontConfig): LLMProvider {
  if (config.llm.provider === 'mock' || !config.llm.apiKey) {
    return new MockProvider();
  }
  return new AnthropicProvider({
    apiKey: config.llm.apiKey,
    model: config.llm.model,
    fastModel: config.llm.fastModel,
  });
}

export function createEmbeddingProvider(config: ValmontConfig): EmbeddingProvider {
  const { provider, apiKey, model, baseUrl, dimensions } = config.embedding;

  if (provider === 'openai' && apiKey) {
    return new OpenAIEmbeddingProvider({ apiKey, model, dimensions });
  }
  if (provider === 'ollama') {
    return new OllamaEmbeddingProvider({
      model,
      dimensions,
      ...(baseUrl ? { baseUrl } : {}),
    });
  }
  return new LocalEmbeddingProvider({ dimensions });
}
