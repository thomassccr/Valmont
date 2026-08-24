import type {
  AnalyticsOverview,
  Creator,
  CreatorInput,
  DashboardStats,
  FavoriteEntity,
  FavoritesBundle,
  ModelSummary,
  GenerationHistoryItem,
  GenerationRequest,
  GenerationResult,
  PreviewRequest,
  PreviewResult,
  PromptTemplate,
  PromptTemplateInput,
  Scenario,
  ScenarioCategory,
  ScenarioInput,
  Script,
  ScriptCategory,
  ScriptFilters,
  ScriptInput,
  ScriptUsageInput,
  ScriptVersion,
  SearchResults,
  User,
  VariableDefinition,
  Variation,
} from '../../shared/types';

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly details?: unknown) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (payload as { error?: string } | null)?.error ?? `Erreur ${response.status}`;
    throw new ApiError(response.status, message, (payload as { details?: unknown } | null)?.details);
  }
  return payload as T;
}

const qs = (params: Record<string, string | number | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : '';
};

export const api = {
  /* Auth */
  me: () => request<User>('GET', '/auth/me'),
  login: (email: string, password: string) =>
    request<User>('POST', '/auth/login', { email, password }),
  logout: () => request<{ ok: true }>('POST', '/auth/logout'),
  users: () => request<User[]>('GET', '/auth/users'),
  createUser: (input: { email: string; name: string; password: string; role: string }) =>
    request<User>('POST', '/auth/users', input),

  /* Créateurs */
  creators: () => request<Creator[]>('GET', '/creators'),
  creator: (id: string) => request<Creator>('GET', `/creators/${id}`),
  createCreator: (input: CreatorInput) => request<Creator>('POST', '/creators', input),
  updateCreator: (id: string, input: CreatorInput) =>
    request<Creator>('PUT', `/creators/${id}`, input),
  deleteCreator: (id: string) => request<{ ok: true }>('DELETE', `/creators/${id}`),

  /* Scénarios */
  scenarios: () =>
    request<{ scenarios: Scenario[]; categories: Record<ScenarioCategory, string> }>(
      'GET',
      '/scenarios',
    ),
  createScenario: (input: ScenarioInput) => request<Scenario>('POST', '/scenarios', input),
  updateScenario: (id: string, input: Partial<ScenarioInput>) =>
    request<Scenario>('PUT', `/scenarios/${id}`, input),
  deleteScenario: (id: string) => request<{ ok: true }>('DELETE', `/scenarios/${id}`),

  /* Templates */
  templates: (filters: { search?: string; category?: string } = {}) =>
    request<PromptTemplate[]>('GET', `/templates${qs(filters)}`),
  template: (id: string) => request<PromptTemplate>('GET', `/templates/${id}`),
  templateCategories: () => request<string[]>('GET', '/templates/categories'),
  defaultTemplateBody: () => request<{ body: string }>('GET', '/templates/default-body'),
  createTemplate: (input: PromptTemplateInput) =>
    request<PromptTemplate>('POST', '/templates', input),
  updateTemplate: (id: string, input: Partial<PromptTemplateInput>) =>
    request<PromptTemplate>('PUT', `/templates/${id}`, input),
  duplicateTemplate: (id: string) => request<PromptTemplate>('POST', `/templates/${id}/duplicate`),
  deleteTemplate: (id: string) => request<{ ok: true }>('DELETE', `/templates/${id}`),

  /* Modèles (vue enrichie : compteurs + performance) */
  models: () => request<ModelSummary[]>('GET', '/models'),
  model: (id: string) => request<ModelSummary>('GET', `/models/${id}`),

  /* Scripts */
  scripts: (filters: ScriptFilters = {}) =>
    request<Script[]>(
      'GET',
      `/scripts${qs({
        model_id: filters.model_id ?? undefined,
        scope: filters.scope,
        category: filters.category,
        tag: filters.tag,
        search: filters.search,
        favorites: filters.favorites ? '1' : undefined,
        recent: filters.recent ? '1' : undefined,
        limit: filters.limit,
      })}`,
    ),
  script: (id: string) => request<Script>('GET', `/scripts/${id}`),
  createScript: (input: ScriptInput) => request<Script>('POST', '/scripts', input),
  updateScript: (id: string, input: Partial<ScriptInput>) =>
    request<Script>('PUT', `/scripts/${id}`, input),
  duplicateScript: (id: string, modelId?: string | null) =>
    request<Script>('POST', `/scripts/${id}/duplicate`, modelId === undefined ? {} : { model_id: modelId }),
  deleteScript: (id: string) => request<{ ok: true }>('DELETE', `/scripts/${id}`),
  scriptVersions: (id: string) => request<ScriptVersion[]>('GET', `/scripts/${id}/versions`),
  recordScriptUsage: (id: string, input: ScriptUsageInput = {}) =>
    request<Script>('POST', `/scripts/${id}/usage`, input),
  scriptVariations: (id: string, input: { count: number; instructions?: string }) =>
    request<Variation[]>('POST', `/scripts/${id}/variations`, input),
  scriptCategories: () => request<ScriptCategory[]>('GET', '/scripts/categories'),
  scriptTags: () => request<{ slug: string; label: string; count: number }[]>('GET', '/scripts/tags'),

  /* Favoris, analytics, recherche */
  toggleFavorite: (entity_type: FavoriteEntity, entity_id: string) =>
    request<{ is_favorite: boolean }>('POST', '/favorites/toggle', { entity_type, entity_id }),
  favorites: () => request<FavoritesBundle>('GET', '/favorites'),
  analytics: () => request<AnalyticsOverview>('GET', '/analytics'),
  search: (q: string) => request<SearchResults>('GET', `/search${qs({ q })}`),

  /* Génération */
  generate: (input: GenerationRequest) => request<GenerationResult>('POST', '/generate', input),
  preview: (input: PreviewRequest) => request<PreviewResult>('POST', '/preview', input),

  /* Historique & divers */
  history: (filters: { creator_id?: string; search?: string; limit?: number } = {}) =>
    request<GenerationHistoryItem[]>('GET', `/generations${qs(filters)}`),
  feedback: (id: string, input: { used_suggestion_id?: string | null; rating?: number | null }) =>
    request<{ ok: true }>('POST', `/generations/${id}/feedback`, input),
  variables: () => request<VariableDefinition[]>('GET', '/variables'),
  stats: () => request<DashboardStats>('GET', '/stats'),
  health: () => request<{ ok: boolean; provider: string; model: string }>('GET', '/health'),
};
