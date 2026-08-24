import type { Creator, GenerationRequest, PromptTemplate, Scenario } from '../../../shared/types.js';
import { FAMILIARITY_LABELS } from '../../../shared/scenarios.js';

const listOf = (values: string[] | undefined, fallback = '—'): string =>
  values && values.length ? values.join(', ') : fallback;

/**
 * Construit la table { variable -> valeur } utilisée par le moteur de rendu.
 * Ordre de priorité : overrides explicites > valeurs par défaut du template > contexte.
 */
export function buildVariableMap(params: {
  creator: Creator | null;
  scenario: Scenario | null;
  request: Partial<GenerationRequest>;
  template?: PromptTemplate | null;
  operatorName?: string;
  overrides?: Record<string, string>;
}): Record<string, string> {
  const { creator, scenario, request, template, operatorName, overrides } = params;

  const base: Record<string, string> = {
    // Créateur
    creator_name: creator?.name ?? '',
    creator_personality: creator?.personality ?? '',
    creator_age: creator?.age ? String(creator.age) : '',
    content_style: creator?.content_style ?? '',
    custom_instructions: creator?.custom_instructions ?? '',
    creator_traits: listOf(creator?.traits),
    creator_style: creator?.writing_style ?? '',
    creator_interests: listOf(creator?.interests),
    preferred_topics: listOf(creator?.preferred_topics),
    banned_topics: listOf(creator?.guardrails.banned_topics, 'aucun'),
    banned_words: listOf(creator?.lexicon.banned_words, 'aucun'),
    signature_phrases: listOf(creator?.lexicon.signature_phrases, '—'),
    audience_type: creator?.audience_type ?? '',
    tone: request.tone_override?.trim() || creator?.tone || '',

    // Scénario
    scenario_name: scenario?.name ?? 'Libre',
    scenario_goal: scenario?.goal ?? request.objective ?? '',
    scenario_beats: listOf(scenario?.beats, '—'),

    // Requête
    subscriber_message: request.subscriber_message ?? '',
    conversation_history: request.conversation_history ?? '',
    conversation_context: request.conversation_context ?? '',
    objective: request.objective ?? '',
    familiarity: request.familiarity ? FAMILIARITY_LABELS[request.familiarity] : '',
    subscriber_alias: request.subscriber_alias ?? "l'abonné",
    subscriber_name: request.subscriber_alias ?? "l'abonné",
    price: request.price ?? '',
    content_type: request.content_type ?? '',
    extra_instructions: request.extra_instructions ?? '',
    variant_count: String(request.variant_count ?? 3),

    // Système
    operator_name: operatorName ?? '',
    date: new Date().toISOString().slice(0, 10),
    max_message_chars: String(creator?.guardrails.max_message_chars ?? 420),
  };

  for (const variable of template?.variables ?? []) {
    if (variable.default_value) base[variable.name] = variable.default_value;
  }

  return { ...base, ...(overrides ?? {}) };
}

export interface RenderResult {
  rendered: string;
  used: string[];
  missing: string[];
}

/**
 * Remplace les {{variables}}. Une variable inconnue ou vide est retirée du texte
 * (jamais laissée telle quelle : un `{{...}}` envoyé au modèle produit des réponses
 * incohérentes) et remontée dans `missing` pour affichage dans l'aperçu.
 */
export function render(body: string, vars: Record<string, string>): RenderResult {
  const used = new Set<string>();
  const missing = new Set<string>();

  const rendered = body.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_match, rawName: string) => {
    const name = rawName.toLowerCase();
    const value = vars[name];
    if (value === undefined || value === '') {
      missing.add(name);
      return '';
    }
    used.add(name);
    return value;
  });

  return {
    rendered: rendered.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
    used: [...used],
    missing: [...missing],
  };
}
