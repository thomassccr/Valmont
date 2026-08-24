import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { Creator, Scenario } from '../../../shared/types.js';
import { env } from '../env.js';

export interface RawSuggestion {
  label: string;
  text: string;
  rationale: string;
  warnings: string[];
}

export interface LlmInput {
  system: string;
  user: string;
  count: number;
  creator: Creator;
  scenario: Scenario | null;
}

export interface VariationInput {
  system: string;
  user: string;
  /** Contenu du script d'origine, utilisé par le mode local. */
  original: string;
  count: number;
}

export interface RawVariation {
  label: string;
  content: string;
  rationale: string;
  warnings: string[];
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  generate(input: LlmInput): Promise<RawSuggestion[]>;
  variations(input: VariationInput): Promise<RawVariation[]>;
}

/* ─────────────────────────  Anthropic  ───────────────────────── */

const SuggestionsSchema = z.object({
  suggestions: z
    .array(
      z.object({
        label: z.string().describe("Angle éditorial en 2 à 4 mots"),
        text: z.string().describe('Message prêt à envoyer, dans la voix du créateur'),
        rationale: z.string().describe("Pourquoi cet angle, en une phrase, pour l'opérateur"),
        warnings: z
          .array(z.string())
          .describe("Points de vigilance pour l'opérateur ; liste vide si aucun"),
      }),
    )
    .describe('Les propositions, de la plus sûre à la plus audacieuse'),
});

const VariationsSchema = z.object({
  variations: z
    .array(
      z.object({
        label: z.string().describe('Angle de la variante, en 2 à 4 mots'),
        content: z.string().describe('Script complet, variables conservées telles quelles'),
        rationale: z.string().describe('Pourquoi cette variante, en une phrase'),
        warnings: z.array(z.string()).describe('Points de vigilance ; liste vide si aucun'),
      }),
    )
    .describe('Les variantes du script'),
});

class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  readonly model = env.llm.model;
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generate(input: LlmInput): Promise<RawSuggestion[]> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: env.llm.maxTokens,
      // Le préfixe système est stable d'une requête à l'autre pour un même créateur :
      // on le marque cacheable afin de réduire coût et latence sur les rafales.
      system: [{ type: 'text', text: input.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: input.user }],
      thinking: { type: 'adaptive' },
      output_config: {
        effort: env.llm.effort,
        format: zodOutputFormat(SuggestionsSchema),
      },
    });

    if (response.stop_reason === 'refusal') {
      throw new Error(
        "Le modèle a refusé de traiter cette demande. Vérifie le contenu du message reçu et escalade si nécessaire.",
      );
    }

    const parsed = response.parsed_output;
    if (!parsed) throw new Error('Réponse du modèle illisible (sortie structurée absente).');

    return parsed.suggestions.slice(0, input.count).map((suggestion) => ({
      label: suggestion.label,
      text: suggestion.text.trim(),
      rationale: suggestion.rationale,
      warnings: suggestion.warnings ?? [],
    }));
  }

  async variations(input: VariationInput): Promise<RawVariation[]> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: env.llm.maxTokens,
      system: [{ type: 'text', text: input.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: input.user }],
      thinking: { type: 'adaptive' },
      output_config: {
        effort: env.llm.effort,
        format: zodOutputFormat(VariationsSchema),
      },
    });

    if (response.stop_reason === 'refusal') {
      throw new Error('Le modèle a refusé de traiter ce script.');
    }
    const parsed = response.parsed_output;
    if (!parsed) throw new Error('Réponse du modèle illisible (sortie structurée absente).');

    return parsed.variations.slice(0, input.count).map((variation) => ({
      label: variation.label,
      content: variation.content.trim(),
      rationale: variation.rationale,
      warnings: variation.warnings ?? [],
    }));
  }
}

/* ─────────────────────────  Mode local (sans clé API)  ───────────────────────── */

/**
 * Compose des ébauches à partir de la fiche créateur et du scénario, sans appel réseau.
 * Sert de mode dégradé (clé absente, incident fournisseur) et de mode démo/test :
 * les ébauches contiennent des marqueurs explicites, jamais de faits inventés.
 */
const LOCAL_NOTICE =
  'Mode local actif (aucune clé API configurée) : ces ébauches doivent être complétées à la main.';

class LocalProvider implements LlmProvider {
  readonly name = 'local';
  readonly model = 'composition-locale';

  async generate(input: LlmInput): Promise<RawSuggestion[]> {
    const { creator, scenario } = input;
    const beats = scenario?.beats ?? ['Accroche', 'Contenu', 'Relance'];
    const interest = creator.interests[0] ?? 'ce dont vous parliez';
    const signature = creator.lexicon.signature_phrases[0] ?? '';
    const emoji = creator.lexicon.emoji_style === 'aucun' ? '' : creator.lexicon.favorite_emojis[0] ?? '';

    const angles: { label: string; build: () => string; rationale: string }[] = [
      {
        label: 'Direct · question ouverte',
        rationale: "Répond au message et rend la main immédiatement à l'abonné.",
        build: () =>
          `[À VÉRIFIER : reprendre le point clé du message reçu] — et toi, ${interest}, ça te parle ? ${emoji}`.trim(),
      },
      {
        label: 'Chaleureux · reprise du contexte',
        rationale: "Réutilise l'historique fourni pour montrer que le message a été lu.",
        build: () =>
          `${signature ? `${signature} ` : ''}[À VÉRIFIER : rappeler un élément de l'historique] ${beats[1] ? `→ ${beats[1].toLowerCase()}` : ''}`.trim(),
      },
      {
        label: 'Court · relance légère',
        rationale: 'Message minimal, utile quand la conversation est froide.',
        build: () => `[À VÉRIFIER : une phrase courte sur ${interest}] ${emoji}`.trim(),
      },
    ];

    return angles.slice(0, input.count).map((angle) => ({
      label: angle.label,
      text: angle.build(),
      rationale: angle.rationale,
      warnings: [LOCAL_NOTICE],
    }));
  }

  /**
   * Sans modèle, on ne réécrit pas un texte. On renvoie des squelettes de
   * variantes qui conservent l'original et ses variables, en indiquant
   * clairement le travail restant à l'opérateur.
   */
  async variations(input: VariationInput): Promise<RawVariation[]> {
    const angles = [
      { label: 'Plus court', hint: 'Retirer une phrase, garder l’essentiel.' },
      { label: 'Plus chaleureux', hint: 'Ajouter une marque d’attention personnelle.' },
      { label: 'Ouverture par question', hint: 'Commencer par la question, finir par l’accroche.' },
      { label: 'Plus direct', hint: 'Aller au message principal dès la première phrase.' },
      { label: 'Plus léger', hint: 'Alléger le ton, retirer toute insistance.' },
    ];
    return angles.slice(0, input.count).map((angle) => ({
      label: angle.label,
      content: `[À RETRAVAILLER — ${angle.hint}]\n\n${input.original}`,
      rationale: angle.hint,
      warnings: [LOCAL_NOTICE],
    }));
  }
}

/* ─────────────────────────  Sélection  ───────────────────────── */

let cached: LlmProvider | null = null;

export function getProvider(): LlmProvider {
  if (cached) return cached;
  if (env.llm.provider === 'anthropic' && env.llm.apiKey) {
    cached = new AnthropicProvider(env.llm.apiKey);
  } else {
    if (env.llm.provider === 'anthropic') {
      console.warn(
        '[cadence] ANTHROPIC_API_KEY absente — bascule sur le mode local (compositions à compléter).',
      );
    }
    cached = new LocalProvider();
  }
  return cached;
}

export const resetProvider = (): void => {
  cached = null;
};
