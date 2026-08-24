import type {
  Creator,
  CreatorInput,
  DashboardStats,
  Familiarity,
  GenerationHistoryItem,
  PromptTemplate,
  PromptTemplateInput,
  Scenario,
  ScenarioInput,
  Suggestion,
  User,
  UserRole,
} from '../../../shared/types.js';
import { DEFAULT_GUARDRAILS, DEFAULT_LEXICON } from '../../../shared/defaults.js';
import { bool, db, flag, json } from './index.js';
import { id, now } from '../lib/id.js';

/* ─────────────────────────  Utilisateurs & sessions  ───────────────────────── */

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: string;
  created_at: string;
}

const toUser = (row: UserRow): User => ({
  id: row.id,
  email: row.email,
  name: row.name,
  role: row.role as UserRole,
  created_at: row.created_at,
});

export const users = {
  findByEmail(email: string): (User & { password_hash: string }) | null {
    const row = db
      .prepare('SELECT * FROM users WHERE lower(email) = lower(?)')
      .get(email) as UserRow | undefined;
    return row ? { ...toUser(row), password_hash: row.password_hash } : null;
  },
  findById(userId: string): User | null {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
    return row ? toUser(row) : null;
  },
  list(): User[] {
    const rows = db.prepare('SELECT * FROM users ORDER BY created_at').all() as UserRow[];
    return rows.map(toUser);
  },
  create(input: { email: string; name: string; passwordHash: string; role: UserRole }): User {
    const row: UserRow = {
      id: id('usr'),
      email: input.email,
      name: input.name,
      password_hash: input.passwordHash,
      role: input.role,
      created_at: now(),
    };
    db.prepare(
      `INSERT INTO users (id, email, name, password_hash, role, created_at)
       VALUES (@id, @email, @name, @password_hash, @role, @created_at)`,
    ).run(row);
    return toUser(row);
  },
  count(): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  },
};

export const sessions = {
  create(userId: string, sessionToken: string, days = 30): void {
    const expires = new Date(Date.now() + days * 86_400_000).toISOString();
    db.prepare(
      'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(sessionToken, userId, now(), expires);
  },
  resolve(sessionToken: string): User | null {
    const row = db
      .prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?')
      .get(sessionToken) as { user_id: string; expires_at: string } | undefined;
    if (!row) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) {
      sessions.destroy(sessionToken);
      return null;
    }
    return users.findById(row.user_id);
  },
  destroy(sessionToken: string): void {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(sessionToken);
  },
};

/* ─────────────────────────  Créateurs  ───────────────────────── */

interface CreatorRow {
  id: string;
  name: string;
  handle: string;
  accent_color: string;
  personality: string;
  traits_json: string;
  tone: string;
  interests_json: string;
  writing_style: string;
  audience_type: string;
  preferred_topics_json: string;
  objectives_json: string;
  lexicon_json: string;
  guardrails_json: string;
  notes: string;
  archived: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const toCreator = (row: CreatorRow): Creator => ({
  id: row.id,
  name: row.name,
  handle: row.handle,
  accent_color: row.accent_color,
  personality: row.personality,
  traits: json.parse<string[]>(row.traits_json, []),
  tone: row.tone,
  interests: json.parse<string[]>(row.interests_json, []),
  writing_style: row.writing_style,
  audience_type: row.audience_type,
  preferred_topics: json.parse<string[]>(row.preferred_topics_json, []),
  objectives: json.parse<string[]>(row.objectives_json, []),
  lexicon: { ...DEFAULT_LEXICON, ...json.parse(row.lexicon_json, {}) },
  guardrails: { ...DEFAULT_GUARDRAILS, ...json.parse(row.guardrails_json, {}) },
  notes: row.notes,
  archived: bool(row.archived),
  created_by: row.created_by,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const creatorParams = (input: CreatorInput) => ({
  name: input.name,
  handle: input.handle ?? '',
  accent_color: input.accent_color || '#7c5cff',
  personality: input.personality ?? '',
  traits_json: json.stringify(input.traits ?? []),
  tone: input.tone ?? '',
  interests_json: json.stringify(input.interests ?? []),
  writing_style: input.writing_style ?? '',
  audience_type: input.audience_type ?? '',
  preferred_topics_json: json.stringify(input.preferred_topics ?? []),
  objectives_json: json.stringify(input.objectives ?? []),
  lexicon_json: json.stringify({ ...DEFAULT_LEXICON, ...input.lexicon }),
  guardrails_json: json.stringify({ ...DEFAULT_GUARDRAILS, ...input.guardrails }),
  notes: input.notes ?? '',
  archived: flag(input.archived),
});

export const creators = {
  list(includeArchived = false): Creator[] {
    const rows = db
      .prepare(
        `SELECT * FROM creators ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY name COLLATE NOCASE`,
      )
      .all() as CreatorRow[];
    return rows.map(toCreator);
  },
  find(creatorId: string): Creator | null {
    const row = db.prepare('SELECT * FROM creators WHERE id = ?').get(creatorId) as
      | CreatorRow
      | undefined;
    return row ? toCreator(row) : null;
  },
  create(input: CreatorInput, userId: string | null): Creator {
    const timestamp = now();
    const params = {
      ...creatorParams(input),
      id: id('crt'),
      created_by: userId,
      created_at: timestamp,
      updated_at: timestamp,
    };
    db.prepare(
      `INSERT INTO creators (id, name, handle, accent_color, personality, traits_json, tone,
        interests_json, writing_style, audience_type, preferred_topics_json, objectives_json,
        lexicon_json, guardrails_json, notes, archived, created_by, created_at, updated_at)
       VALUES (@id, @name, @handle, @accent_color, @personality, @traits_json, @tone,
        @interests_json, @writing_style, @audience_type, @preferred_topics_json, @objectives_json,
        @lexicon_json, @guardrails_json, @notes, @archived, @created_by, @created_at, @updated_at)`,
    ).run(params);
    return creators.find(params.id)!;
  },
  update(creatorId: string, input: CreatorInput): Creator | null {
    const existing = creators.find(creatorId);
    if (!existing) return null;
    const params = { ...creatorParams({ ...existing, ...input }), id: creatorId, updated_at: now() };
    db.prepare(
      `UPDATE creators SET name=@name, handle=@handle, accent_color=@accent_color,
        personality=@personality, traits_json=@traits_json, tone=@tone,
        interests_json=@interests_json, writing_style=@writing_style, audience_type=@audience_type,
        preferred_topics_json=@preferred_topics_json, objectives_json=@objectives_json,
        lexicon_json=@lexicon_json, guardrails_json=@guardrails_json, notes=@notes,
        archived=@archived, updated_at=@updated_at
       WHERE id=@id`,
    ).run(params);
    return creators.find(creatorId);
  },
  remove(creatorId: string): boolean {
    return db.prepare('DELETE FROM creators WHERE id = ?').run(creatorId).changes > 0;
  },
  count(): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM creators WHERE archived = 0').get() as { n: number })
      .n;
  },
};

/* ─────────────────────────  Scénarios  ───────────────────────── */

interface ScenarioRow {
  id: string;
  key: string;
  name: string;
  category: string;
  description: string;
  goal: string;
  beats_json: string;
  do_json: string;
  dont_json: string;
  suggested_familiarity: string | null;
  is_system: number;
  created_at: string;
  updated_at: string;
}

const toScenario = (row: ScenarioRow): Scenario => ({
  id: row.id,
  key: row.key,
  name: row.name,
  category: row.category as Scenario['category'],
  description: row.description,
  goal: row.goal,
  beats: json.parse<string[]>(row.beats_json, []),
  do_list: json.parse<string[]>(row.do_json, []),
  dont_list: json.parse<string[]>(row.dont_json, []),
  suggested_familiarity: (row.suggested_familiarity as Familiarity | null) ?? null,
  is_system: bool(row.is_system),
  created_at: row.created_at,
  updated_at: row.updated_at,
});

export const scenarios = {
  list(): Scenario[] {
    const rows = db
      .prepare('SELECT * FROM scenarios ORDER BY is_system DESC, name COLLATE NOCASE')
      .all() as ScenarioRow[];
    return rows.map(toScenario);
  },
  find(scenarioId: string): Scenario | null {
    const row = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(scenarioId) as
      | ScenarioRow
      | undefined;
    return row ? toScenario(row) : null;
  },
  findByKey(key: string): Scenario | null {
    const row = db.prepare('SELECT * FROM scenarios WHERE key = ?').get(key) as
      | ScenarioRow
      | undefined;
    return row ? toScenario(row) : null;
  },
  create(input: ScenarioInput, isSystem = false): Scenario {
    const timestamp = now();
    const params = {
      id: id('scn'),
      key: input.key,
      name: input.name,
      category: input.category,
      description: input.description ?? '',
      goal: input.goal ?? '',
      beats_json: json.stringify(input.beats ?? []),
      do_json: json.stringify(input.do_list ?? []),
      dont_json: json.stringify(input.dont_list ?? []),
      suggested_familiarity: input.suggested_familiarity,
      is_system: flag(isSystem),
      created_at: timestamp,
      updated_at: timestamp,
    };
    db.prepare(
      `INSERT INTO scenarios (id, key, name, category, description, goal, beats_json, do_json,
        dont_json, suggested_familiarity, is_system, created_at, updated_at)
       VALUES (@id, @key, @name, @category, @description, @goal, @beats_json, @do_json,
        @dont_json, @suggested_familiarity, @is_system, @created_at, @updated_at)`,
    ).run(params);
    return scenarios.find(params.id)!;
  },
  update(scenarioId: string, input: Partial<ScenarioInput>): Scenario | null {
    const existing = scenarios.find(scenarioId);
    if (!existing) return null;
    const merged = { ...existing, ...input };
    db.prepare(
      `UPDATE scenarios SET name=@name, category=@category, description=@description, goal=@goal,
        beats_json=@beats_json, do_json=@do_json, dont_json=@dont_json,
        suggested_familiarity=@suggested_familiarity, updated_at=@updated_at
       WHERE id=@id`,
    ).run({
      id: scenarioId,
      name: merged.name,
      category: merged.category,
      description: merged.description,
      goal: merged.goal,
      beats_json: json.stringify(merged.beats ?? []),
      do_json: json.stringify(merged.do_list ?? []),
      dont_json: json.stringify(merged.dont_list ?? []),
      suggested_familiarity: merged.suggested_familiarity,
      updated_at: now(),
    });
    return scenarios.find(scenarioId);
  },
  remove(scenarioId: string): boolean {
    return (
      db.prepare('DELETE FROM scenarios WHERE id = ? AND is_system = 0').run(scenarioId).changes > 0
    );
  },
};

/* ─────────────────────────  Templates  ───────────────────────── */

interface TemplateRow {
  id: string;
  name: string;
  description: string;
  category: string;
  tags_json: string;
  body: string;
  variables_json: string;
  scenario_id: string | null;
  creator_id: string | null;
  is_favorite: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const toTemplate = (row: TemplateRow): PromptTemplate => ({
  id: row.id,
  name: row.name,
  description: row.description,
  category: row.category,
  tags: json.parse<string[]>(row.tags_json, []),
  body: row.body,
  variables: json.parse<PromptTemplate['variables']>(row.variables_json, []),
  scenario_id: row.scenario_id,
  creator_id: row.creator_id,
  is_favorite: bool(row.is_favorite),
  created_by: row.created_by,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

export const templates = {
  list(
    filters: { search?: string; category?: string; scenarioId?: string; creatorId?: string } = {},
  ): PromptTemplate[] {
    const where: string[] = [];
    const params: Record<string, string> = {};
    if (filters.search) {
      where.push('(name LIKE @q OR description LIKE @q OR body LIKE @q OR tags_json LIKE @q)');
      params.q = `%${filters.search}%`;
    }
    if (filters.category) {
      where.push('category = @category');
      params.category = filters.category;
    }
    if (filters.scenarioId) {
      where.push('scenario_id = @scenarioId');
      params.scenarioId = filters.scenarioId;
    }
    if (filters.creatorId) {
      where.push('(creator_id = @creatorId OR creator_id IS NULL)');
      params.creatorId = filters.creatorId;
    }
    const rows = db
      .prepare(
        `SELECT * FROM templates ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY is_favorite DESC, updated_at DESC`,
      )
      .all(params) as TemplateRow[];
    return rows.map(toTemplate);
  },
  find(templateId: string): PromptTemplate | null {
    const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId) as
      | TemplateRow
      | undefined;
    return row ? toTemplate(row) : null;
  },
  create(input: PromptTemplateInput, userId: string | null): PromptTemplate {
    const timestamp = now();
    const params = {
      id: id('tpl'),
      name: input.name,
      description: input.description ?? '',
      category: input.category || 'Général',
      tags_json: json.stringify(input.tags ?? []),
      body: input.body ?? '',
      variables_json: json.stringify(input.variables ?? []),
      scenario_id: input.scenario_id ?? null,
      creator_id: input.creator_id ?? null,
      is_favorite: flag(input.is_favorite),
      created_by: userId,
      created_at: timestamp,
      updated_at: timestamp,
    };
    db.prepare(
      `INSERT INTO templates (id, name, description, category, tags_json, body, variables_json,
        scenario_id, creator_id, is_favorite, created_by, created_at, updated_at)
       VALUES (@id, @name, @description, @category, @tags_json, @body, @variables_json,
        @scenario_id, @creator_id, @is_favorite, @created_by, @created_at, @updated_at)`,
    ).run(params);
    return templates.find(params.id)!;
  },
  update(templateId: string, input: Partial<PromptTemplateInput>): PromptTemplate | null {
    const existing = templates.find(templateId);
    if (!existing) return null;
    const merged = { ...existing, ...input };
    db.prepare(
      `UPDATE templates SET name=@name, description=@description, category=@category,
        tags_json=@tags_json, body=@body, variables_json=@variables_json, scenario_id=@scenario_id,
        creator_id=@creator_id, is_favorite=@is_favorite, updated_at=@updated_at
       WHERE id=@id`,
    ).run({
      id: templateId,
      name: merged.name,
      description: merged.description,
      category: merged.category,
      tags_json: json.stringify(merged.tags ?? []),
      body: merged.body,
      variables_json: json.stringify(merged.variables ?? []),
      scenario_id: merged.scenario_id ?? null,
      creator_id: merged.creator_id ?? null,
      is_favorite: flag(merged.is_favorite),
      updated_at: now(),
    });
    return templates.find(templateId);
  },
  remove(templateId: string): boolean {
    return db.prepare('DELETE FROM templates WHERE id = ?').run(templateId).changes > 0;
  },
  categories(): string[] {
    const rows = db
      .prepare('SELECT DISTINCT category FROM templates ORDER BY category COLLATE NOCASE')
      .all() as { category: string }[];
    return rows.map((r) => r.category);
  },
  count(): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM templates').get() as { n: number }).n;
  },
};

/* ─────────────────────────  Générations  ───────────────────────── */

interface GenerationRow {
  id: string;
  creator_id: string;
  creator_name: string | null;
  scenario_id: string | null;
  scenario_name: string | null;
  operator_id: string | null;
  operator_name: string | null;
  subscriber_alias: string | null;
  subscriber_message: string;
  objective: string;
  familiarity: string;
  suggestions_json: string;
  provider: string;
  model: string;
  latency_ms: number;
  used_suggestion_id: string | null;
  rating: number | null;
  created_at: string;
}

const HISTORY_SELECT = `
  SELECT g.*, c.name AS creator_name, s.name AS scenario_name, u.name AS operator_name
  FROM generations g
  LEFT JOIN creators c ON c.id = g.creator_id
  LEFT JOIN scenarios s ON s.id = g.scenario_id
  LEFT JOIN users u ON u.id = g.operator_id`;

const toHistory = (row: GenerationRow): GenerationHistoryItem => ({
  id: row.id,
  creator_id: row.creator_id,
  creator_name: row.creator_name ?? 'Créateur supprimé',
  scenario_id: row.scenario_id,
  scenario_name: row.scenario_name,
  operator_id: row.operator_id,
  operator_name: row.operator_name,
  subscriber_alias: row.subscriber_alias,
  subscriber_message: row.subscriber_message,
  objective: row.objective,
  familiarity: row.familiarity as Familiarity,
  suggestions: json.parse<Suggestion[]>(row.suggestions_json, []),
  provider: row.provider,
  model: row.model,
  latency_ms: row.latency_ms,
  used_suggestion_id: row.used_suggestion_id,
  rating: row.rating,
  created_at: row.created_at,
});

export interface GenerationRecord {
  id: string;
  creator_id: string;
  scenario_id: string | null;
  template_id: string | null;
  operator_id: string | null;
  subscriber_alias: string | null;
  subscriber_message: string;
  conversation_history: string;
  conversation_context: string;
  objective: string;
  familiarity: Familiarity;
  suggestions: Suggestion[];
  system_prompt: string;
  user_prompt: string;
  provider: string;
  model: string;
  latency_ms: number;
}

export const generations = {
  save(record: GenerationRecord): void {
    db.prepare(
      `INSERT INTO generations (id, creator_id, scenario_id, template_id, operator_id,
        subscriber_alias, subscriber_message, conversation_history, conversation_context,
        objective, familiarity, suggestions_json, system_prompt, user_prompt, provider, model,
        latency_ms, created_at)
       VALUES (@id, @creator_id, @scenario_id, @template_id, @operator_id, @subscriber_alias,
        @subscriber_message, @conversation_history, @conversation_context, @objective,
        @familiarity, @suggestions_json, @system_prompt, @user_prompt, @provider, @model,
        @latency_ms, @created_at)`,
    ).run({
      id: record.id,
      creator_id: record.creator_id,
      scenario_id: record.scenario_id,
      template_id: record.template_id,
      operator_id: record.operator_id,
      subscriber_alias: record.subscriber_alias,
      subscriber_message: record.subscriber_message,
      conversation_history: record.conversation_history,
      conversation_context: record.conversation_context,
      objective: record.objective,
      familiarity: record.familiarity,
      system_prompt: record.system_prompt,
      user_prompt: record.user_prompt,
      provider: record.provider,
      model: record.model,
      latency_ms: record.latency_ms,
      suggestions_json: json.stringify(record.suggestions),
      created_at: now(),
    });
  },
  list(
    filters: { creatorId?: string; operatorId?: string; search?: string; limit?: number } = {},
  ): GenerationHistoryItem[] {
    const where: string[] = [];
    const params: Record<string, string | number> = { limit: filters.limit ?? 100 };
    if (filters.creatorId) {
      where.push('g.creator_id = @creatorId');
      params.creatorId = filters.creatorId;
    }
    if (filters.operatorId) {
      where.push('g.operator_id = @operatorId');
      params.operatorId = filters.operatorId;
    }
    if (filters.search) {
      where.push(
        '(g.subscriber_message LIKE @q OR g.objective LIKE @q OR g.suggestions_json LIKE @q)',
      );
      params.q = `%${filters.search}%`;
    }
    const rows = db
      .prepare(
        `${HISTORY_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY g.created_at DESC LIMIT @limit`,
      )
      .all(params) as GenerationRow[];
    return rows.map(toHistory);
  },
  find(generationId: string): GenerationHistoryItem | null {
    const row = db.prepare(`${HISTORY_SELECT} WHERE g.id = ?`).get(generationId) as
      | GenerationRow
      | undefined;
    return row ? toHistory(row) : null;
  },
  feedback(
    generationId: string,
    patch: { used_suggestion_id?: string | null; rating?: number | null },
  ): boolean {
    const current = generations.find(generationId);
    if (!current) return false;
    db.prepare('UPDATE generations SET used_suggestion_id = ?, rating = ? WHERE id = ?').run(
      patch.used_suggestion_id !== undefined ? patch.used_suggestion_id : current.used_suggestion_id,
      patch.rating !== undefined ? patch.rating : current.rating,
      generationId,
    );
    return true;
  },
};

/* ─────────────────────────  Statistiques  ───────────────────────── */

export function dashboardStats(): DashboardStats {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(Date.now() - 7 * 86_400_000);

  const countSince = (iso: string) =>
    (db.prepare('SELECT COUNT(*) AS n FROM generations WHERE created_at >= ?').get(iso) as {
      n: number;
    }).n;

  const latency = db
    .prepare('SELECT AVG(latency_ms) AS avg FROM generations WHERE created_at >= ?')
    .get(weekStart.toISOString()) as { avg: number | null };

  const top = db
    .prepare(
      `SELECT COALESCE(s.name, 'Sans scénario') AS name, COUNT(*) AS count
       FROM generations g LEFT JOIN scenarios s ON s.id = g.scenario_id
       WHERE g.created_at >= ? GROUP BY name ORDER BY count DESC LIMIT 5`,
    )
    .all(weekStart.toISOString()) as { name: string; count: number }[];

  return {
    generations_today: countSince(todayStart.toISOString()),
    generations_week: countSince(weekStart.toISOString()),
    creators_active: creators.count(),
    templates_total: templates.count(),
    avg_latency_ms: Math.round(latency.avg ?? 0),
    top_scenarios: top,
    recent: generations.list({ limit: 8 }),
  };
}

export function metaGet(key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function metaSet(key: string, value: string): void {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}
