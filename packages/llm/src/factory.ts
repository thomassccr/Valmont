import type { LLMProviderName, ValmontConfig } from '@valmont/kernel';
import { AnthropicProvider } from './anthropic.js';
import { GroqProvider } from './groq.js';
import { MockProvider } from './mock.js';
import { RoutedProvider } from './routed.js';
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
function buildProvider(
  name: LLMProviderName,
  config: ValmontConfig,
  models: { model: string; fastModel: string },
): LLMProvider {
  switch (name) {
    case 'anthropic':
      // Sans clé, on ne renvoie pas un client cassé qui échouera au premier
      // appel : on renvoie le fournisseur factice, qui dit explicitement ce
      // qui manque.
      return config.llm.apiKey
        ? new AnthropicProvider({
            apiKey: config.llm.apiKey,
            model: models.model,
            fastModel: models.fastModel,
          })
        : new MockProvider();

    case 'groq':
      return config.llm.groqApiKey
        ? new GroqProvider({
            apiKey: config.llm.groqApiKey,
            model: models.model,
            fastModel: models.fastModel,
          })
        : new MockProvider();

    default:
      return new MockProvider();
  }
}

export function createLLMProvider(config: ValmontConfig): LLMProvider {
  const { provider, fastProvider, model, fastModel } = config.llm;

  const voice = buildProvider(provider, config, { model, fastModel });

  // Un seul fournisseur pour tout : cas courant, rien à router.
  if (fastProvider === provider) return voice;

  const background = buildProvider(fastProvider, config, {
    model: fastModel,
    fastModel,
  });
  return new RoutedProvider(voice, background);
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
