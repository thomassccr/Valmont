import type {
  Creator,
  CreatorInput,
  DashboardStats,
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
  User,
  VariableDefinition,
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
