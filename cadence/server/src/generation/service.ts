import type {
  GenerationRequest,
  GenerationResult,
  PreviewRequest,
  PreviewResult,
  Suggestion,
  SuggestionWarning,
  User,
} from '../../../shared/types.js';
import { creators, generations, scenarios, templates } from '../db/repos.js';
import { badRequest, notFound } from '../lib/errors.js';
import { id } from '../lib/id.js';
import { getProvider } from './llm.js';
import { DEFAULT_TEMPLATE_BODY, buildSystemPrompt } from './prompt.js';
import { analyzeIncomingMessage, hasBlocking, validateSuggestion } from './validate.js';
import { buildVariableMap, render } from './variables.js';

/** Consigne injectée quand le message reçu contient des signaux de détresse. */
const CARE_MODE = `
════════════════════════

MODE VIGILANCE ACTIF — le message reçu contient des signaux de détresse, de dépendance ou de
difficulté financière. Aucune des propositions ne doit contenir de relance commerciale, de
proposition d'achat, ni d'incitation à dépenser. Propose des réponses humaines, sobres, qui
laissent la porte ouverte sans rien vendre.`;

export async function generate(
  request: GenerationRequest,
  operator: User | null,
): Promise<GenerationResult> {
  const creator = creators.find(request.creator_id);
  if (!creator) throw notFound('Créateur introuvable');

  const scenario = request.scenario_id ? scenarios.find(request.scenario_id) : null;
  const template = request.template_id ? templates.find(request.template_id) : null;
  if (request.template_id && !template) throw notFound('Template introuvable');

  if (!request.subscriber_message.trim() && !request.conversation_context.trim()) {
    throw badRequest("Renseigne au moins le message reçu ou le contexte de la conversation.");
  }

  const requestWarnings = analyzeIncomingMessage(
    `${request.subscriber_message}\n${request.conversation_history}`,
  );

  const variables = buildVariableMap({
    creator,
    scenario,
    request,
    template,
    operatorName: operator?.name,
  });
  const { rendered: userPrompt } = render(template?.body || DEFAULT_TEMPLATE_BODY, variables);

  let systemPrompt = buildSystemPrompt({
    creator,
    scenario,
    familiarity: request.familiarity,
  });
  if (requestWarnings.some((w) => w.code === 'distress_signal')) systemPrompt += CARE_MODE;

  const generationId = id('gen');

  // Escalade : on ne génère rien, mais la demande est tracée dans l'historique.
  if (hasBlocking(requestWarnings)) {
    const result: GenerationResult = {
      id: generationId,
      creator_id: creator.id,
      scenario_id: scenario?.id ?? null,
      template_id: template?.id ?? null,
      suggestions: [],
      warnings: requestWarnings,
      system_prompt: systemPrompt,
      user_prompt: userPrompt,
      provider: 'blocked',
      model: '—',
      latency_ms: 0,
      created_at: new Date().toISOString(),
    };
    persist(result, request, operator);
    return result;
  }

  const provider = getProvider();
  const started = Date.now();
  const raw = await provider.generate({
    system: systemPrompt,
    user: userPrompt,
    count: request.variant_count,
    creator,
    scenario,
  });
  const latency = Date.now() - started;

  const suggestions: Suggestion[] = raw.map((item) => {
    const modelWarnings: SuggestionWarning[] = (item.warnings ?? [])
      .filter((message) => message.trim().length > 0)
      .map((message) => ({ code: 'model_note', severity: 'info', message }));
    return {
      id: id('sug'),
      label: item.label,
      text: item.text,
      rationale: item.rationale,
      char_count: item.text.length,
      warnings: [...validateSuggestion(item.text, creator), ...modelWarnings],
    };
  });

  const result: GenerationResult = {
    id: generationId,
    creator_id: creator.id,
    scenario_id: scenario?.id ?? null,
    template_id: template?.id ?? null,
    suggestions,
    warnings: requestWarnings,
    system_prompt: systemPrompt,
    user_prompt: userPrompt,
    provider: provider.name,
    model: provider.model,
    latency_ms: latency,
    created_at: new Date().toISOString(),
  };

  persist(result, request, operator);
  return result;
}

function persist(
  result: GenerationResult,
  request: GenerationRequest,
  operator: User | null,
): void {
  generations.save({
    id: result.id,
    creator_id: result.creator_id,
    scenario_id: result.scenario_id,
    template_id: result.template_id,
    operator_id: operator?.id ?? null,
    subscriber_alias: request.subscriber_alias ?? null,
    subscriber_message: request.subscriber_message,
    conversation_history: request.conversation_history,
    conversation_context: request.conversation_context,
    objective: request.objective,
    familiarity: request.familiarity,
    suggestions: result.suggestions,
    system_prompt: result.system_prompt,
    user_prompt: result.user_prompt,
    provider: result.provider,
    model: result.model,
    latency_ms: result.latency_ms,
  });
}

/** Rendu d'un template sans appel au modèle : utilisé par l'aperçu temps réel. */
export function preview(input: PreviewRequest, operator: User | null): PreviewResult {
  const creator = input.creator_id ? creators.find(input.creator_id) : null;
  const scenario = input.scenario_id ? scenarios.find(input.scenario_id) : null;
  const variables = buildVariableMap({
    creator,
    scenario,
    request: input.request ?? {},
    operatorName: operator?.name,
    overrides: input.overrides,
  });
  return render(input.body, variables);
}
