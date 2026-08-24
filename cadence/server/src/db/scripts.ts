import { performanceScore } from '../../../shared/scripts.js';
import type {
  AnalyticsOverview,
  FavoriteEntity,
  ModelPerformance,
  ModelSummary,
  Script,
  ScriptCategory,
  ScriptFilters,
  ScriptInput,
  ScriptUsageInput,
  ScriptVariable,
  ScriptVersion,
} from '../../../shared/types.js';
import { id, now } from '../lib/id.js';
import { bool, db, json } from './index.js';
import { creators } from './repos.js';

/* ─────────────────────────  Catégories  ───────────────────────── */

interface CategoryRow {
  id: string;
  key: string;
  label: string;
  sort_order: number;
  is_system: number;
}

const toCategory = (row: CategoryRow): ScriptCategory => ({
  id: row.id,
  key: row.key,
  label: row.label,
  sort_order: row.sort_order,
  is_system: bool(row.is_system),
});

export const scriptCategories = {
  list(): ScriptCategory[] {
    const rows = db
      .prepare('SELECT * FROM script_categories ORDER BY sort_order, label')
      .all() as CategoryRow[];
    return rows.map(toCategory);
  },
  findByKey(key: string): ScriptCategory | null {
    const row = db.prepare('SELECT * FROM script_categories WHERE key = ?').get(key) as
      | CategoryRow
      | undefined;
    return row ? toCategory(row) : null;
  },
  ensure(input: { key: string; label: string; sort_order: number; isSystem: boolean }): ScriptCategory {
    const existing = scriptCategories.findByKey(input.key);
    if (existing) return existing;
    db.prepare(
      'INSERT INTO script_categories (id, key, label, sort_order, is_system) VALUES (?, ?, ?, ?, ?)',
    ).run(id('cat'), input.key, input.label, input.sort_order, input.isSystem ? 1 : 0);
    return scriptCategories.findByKey(input.key)!;
  },
};

/* ─────────────────────────  Tags  ───────────────────────── */

const slugify = (label: string): string =>
  label
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const scriptTags = {
  list(): { slug: string; label: string; count: number }[] {
    return db
      .prepare(
        `SELECT t.slug, t.label, COUNT(l.script_id) AS count
         FROM script_tags t LEFT JOIN script_tag_links l ON l.tag_id = t.id
         GROUP BY t.id HAVING count > 0 ORDER BY count DESC, t.label`,
      )
      .all() as { slug: string; label: string; count: number }[];
  },
  /** Remplace l'ensemble des tags d'un script (crée les tags manquants). */
  sync(scriptId: string, labels: string[]): void {
    db.prepare('DELETE FROM script_tag_links WHERE script_id = ?').run(scriptId);
    for (const label of labels) {
      const slug = slugify(label);
      if (!slug) continue;
      let tag = db.prepare('SELECT id FROM script_tags WHERE slug = ?').get(slug) as
        | { id: string }
        | undefined;
      if (!tag) {
        const tagId = id('tag');
        db.prepare('INSERT INTO script_tags (id, slug, label) VALUES (?, ?, ?)').run(
          tagId,
          slug,
          label.trim(),
        );
        tag = { id: tagId };
      }
      db.prepare(
        'INSERT OR IGNORE INTO script_tag_links (script_id, tag_id) VALUES (?, ?)',
      ).run(scriptId, tag.id);
    }
  },
  forScripts(scriptIds: string[]): Map<string, string[]> {
    const map = new Map<string, string[]>();
    if (!scriptIds.length) return map;
    const placeholders = scriptIds.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT l.script_id, t.label FROM script_tag_links l
         JOIN script_tags t ON t.id = l.tag_id
         WHERE l.script_id IN (${placeholders}) ORDER BY t.label`,
      )
      .all(...scriptIds) as { script_id: string; label: string }[];
    for (const row of rows) {
      map.set(row.script_id, [...(map.get(row.script_id) ?? []), row.label]);
    }
    return map;
  },
};

/* ─────────────────────────  Scripts  ───────────────────────── */

interface ScriptRow {
  id: string;
  model_id: string | null;
  model_name: string | null;
  category_key: string;
  category_label: string;
  name: string;
  description: string;
  objective: string;
  tone: string;
  trigger_hint: string;
  content: string;
  variables_json: string;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  usage_count: number;
  converted_count: number;
  revenue_cents: number;
  last_used_at: string | null;
  is_favorite: number;
}

/**
 * Les statistiques sont calculées à la volée depuis `script_usage` plutôt que
 * dénormalisées : une correction d'usage se répercute immédiatement, et le
 * volume (quelques milliers de lignes par agence) ne justifie pas de cache.
 */
const SCRIPT_SELECT = `
  SELECT s.*, c.key AS category_key, c.label AS category_label, m.name AS model_name,
    (SELECT COUNT(*) FROM script_usage u WHERE u.script_id = s.id) AS usage_count,
    (SELECT COUNT(*) FROM script_usage u WHERE u.script_id = s.id AND u.converted = 1) AS converted_count,
    (SELECT COALESCE(SUM(u.revenue_cents), 0) FROM script_usage u WHERE u.script_id = s.id) AS revenue_cents,
    (SELECT MAX(u.used_at) FROM script_usage u WHERE u.script_id = s.id) AS last_used_at,
    (SELECT COUNT(*) FROM favorites f WHERE f.user_id = @userId
       AND f.entity_type = 'script' AND f.entity_id = s.id) AS is_favorite
  FROM scripts s
  JOIN script_categories c ON c.id = s.category_id
  LEFT JOIN creators m ON m.id = s.model_id`;

function toScript(row: ScriptRow, tags: string[]): Script {
  const conversion = row.usage_count ? row.converted_count / row.usage_count : 0;
  return {
    id: row.id,
    model_id: row.model_id,
    model_name: row.model_name,
    category_key: row.category_key,
    category_label: row.category_label,
    name: row.name,
    description: row.description,
    objective: row.objective,
    tone: row.tone,
    trigger: row.trigger_hint,
    content: row.content,
    tags,
    variables: json.parse<ScriptVariable[]>(row.variables_json, []),
    is_favorite: row.is_favorite > 0,
    usage_count: row.usage_count,
    last_used_at: row.last_used_at,
    conversion_rate: Number(conversion.toFixed(3)),
    revenue_cents: row.revenue_cents,
    performance_score: performanceScore({
      usage_count: row.usage_count,
      conversion_rate: conversion,
      revenue_cents: row.revenue_cents,
    }),
    version: row.version,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const hydrate = (rows: ScriptRow[]): Script[] => {
  const tags = scriptTags.forScripts(rows.map((row) => row.id));
  return rows.map((row) => toScript(row, tags.get(row.id) ?? []));
};

export const scripts = {
  list(filters: ScriptFilters, userId: string): Script[] {
    const where: string[] = [];
    const params: Record<string, unknown> = { userId, limit: filters.limit ?? 300 };

    if (filters.scope === 'global') {
      where.push('s.model_id IS NULL');
    } else if (filters.model_id) {
      // 'all' (défaut) : les scripts du modèle ET la bibliothèque globale,
      // sans jamais dupliquer un script global dans le modèle.
      where.push(filters.scope === 'model' ? 's.model_id = @modelId' : '(s.model_id = @modelId OR s.model_id IS NULL)');
      params.modelId = filters.model_id;
    }
    if (filters.category) {
      where.push('c.key = @category');
      params.category = filters.category;
    }
    if (filters.tag) {
      where.push(
        `EXISTS (SELECT 1 FROM script_tag_links l JOIN script_tags t ON t.id = l.tag_id
                 WHERE l.script_id = s.id AND t.slug = @tag)`,
      );
      params.tag = filters.tag;
    }
    if (filters.search) {
      where.push(
        '(s.name LIKE @q OR s.description LIKE @q OR s.content LIKE @q OR s.objective LIKE @q OR s.trigger_hint LIKE @q)',
      );
      params.q = `%${filters.search}%`;
    }
    if (filters.favorites) {
      where.push(
        `EXISTS (SELECT 1 FROM favorites f WHERE f.user_id = @userId
                 AND f.entity_type = 'script' AND f.entity_id = s.id)`,
      );
    }
    if (filters.recent) {
      where.push('EXISTS (SELECT 1 FROM script_usage u WHERE u.script_id = s.id)');
    }

    const order = filters.recent ? 'last_used_at DESC' : 's.updated_at DESC';
    const rows = db
      .prepare(
        `${SCRIPT_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY is_favorite DESC, ${order} LIMIT @limit`,
      )
      .all(params) as ScriptRow[];
    return hydrate(rows);
  },

  find(scriptId: string, userId: string | null): Script | null {
    const row = db.prepare(`${SCRIPT_SELECT} WHERE s.id = @id`).get({ id: scriptId, userId }) as
      | ScriptRow
      | undefined;
    return row ? hydrate([row])[0] : null;
  },

  create(input: ScriptInput, userId: string | null): Script {
    const category = scriptCategories.findByKey(input.category_key);
    if (!category) throw new Error(`Catégorie inconnue : ${input.category_key}`);

    const scriptId = id('scr');
    const timestamp = now();
    db.prepare(
      `INSERT INTO scripts (id, model_id, category_id, name, description, objective, tone,
        trigger_hint, content, variables_json, version, created_by, created_at, updated_at)
       VALUES (@id, @model_id, @category_id, @name, @description, @objective, @tone,
        @trigger_hint, @content, @variables_json, 1, @created_by, @created_at, @updated_at)`,
    ).run({
      id: scriptId,
      model_id: input.model_id ?? null,
      category_id: category.id,
      name: input.name,
      description: input.description ?? '',
      objective: input.objective ?? '',
      tone: input.tone ?? '',
      trigger_hint: input.trigger ?? '',
      content: input.content ?? '',
      variables_json: json.stringify(input.variables ?? []),
      created_by: userId,
      created_at: timestamp,
      updated_at: timestamp,
    });
    scriptTags.sync(scriptId, input.tags ?? []);
    saveVersion(scriptId, 1, input.name, input.content ?? '', userId);
    return scripts.find(scriptId, userId)!;
  },

  update(scriptId: string, input: Partial<ScriptInput>, userId: string): Script | null {
    const existing = scripts.find(scriptId, userId);
    if (!existing) return null;

    const category = input.category_key
      ? scriptCategories.findByKey(input.category_key)
      : scriptCategories.findByKey(existing.category_key);
    if (!category) throw new Error(`Catégorie inconnue : ${input.category_key}`);

    const merged = { ...existing, ...input };
    // Une nouvelle version n'est créée que si le contenu ou le nom change :
    // renommer un tag ou corriger une description ne pollue pas l'historique.
    const contentChanged = merged.content !== existing.content || merged.name !== existing.name;
    const version = contentChanged ? existing.version + 1 : existing.version;

    db.prepare(
      `UPDATE scripts SET model_id=@model_id, category_id=@category_id, name=@name,
        description=@description, objective=@objective, tone=@tone, trigger_hint=@trigger_hint,
        content=@content, variables_json=@variables_json, version=@version, updated_at=@updated_at
       WHERE id=@id`,
    ).run({
      id: scriptId,
      model_id: merged.model_id ?? null,
      category_id: category.id,
      name: merged.name,
      description: merged.description,
      objective: merged.objective,
      tone: merged.tone,
      trigger_hint: merged.trigger,
      content: merged.content,
      variables_json: json.stringify(merged.variables ?? []),
      version,
      updated_at: now(),
    });
    if (input.tags) scriptTags.sync(scriptId, input.tags);
    if (contentChanged) saveVersion(scriptId, version, merged.name, merged.content, userId);
    return scripts.find(scriptId, userId);
  },

  duplicate(scriptId: string, userId: string, overrides: Partial<ScriptInput> = {}): Script | null {
    const source = scripts.find(scriptId, userId);
    if (!source) return null;
    return scripts.create(
      {
        model_id: overrides.model_id !== undefined ? overrides.model_id : source.model_id,
        category_key: source.category_key,
        name: overrides.name ?? `${source.name} (copie)`,
        description: source.description,
        objective: source.objective,
        tone: source.tone,
        trigger: source.trigger,
        content: source.content,
        tags: source.tags,
        variables: source.variables,
      },
      userId,
    );
  },

  remove(scriptId: string): boolean {
    return db.prepare('DELETE FROM scripts WHERE id = ?').run(scriptId).changes > 0;
  },

  count(modelId?: string | null): number {
    const query = modelId
      ? 'SELECT COUNT(*) AS n FROM scripts WHERE model_id = ?'
      : 'SELECT COUNT(*) AS n FROM scripts';
    return (db.prepare(query).get(...(modelId ? [modelId] : [])) as { n: number }).n;
  },

  /** Enregistre une utilisation réelle : socle des statistiques de performance. */
  recordUsage(scriptId: string, userId: string | null, input: ScriptUsageInput = {}): void {
    const script = db.prepare('SELECT model_id FROM scripts WHERE id = ?').get(scriptId) as
      | { model_id: string | null }
      | undefined;
    if (!script) return;
    db.prepare(
      `INSERT INTO script_usage (id, script_id, model_id, user_id, converted, revenue_cents, note, used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id('use'),
      scriptId,
      script.model_id,
      userId,
      input.converted ? 1 : 0,
      Math.max(0, Math.round(input.revenue_cents ?? 0)),
      input.note ?? '',
      now(),
    );
  },

  versions(scriptId: string): ScriptVersion[] {
    return db
      .prepare(
        `SELECT v.*, u.name AS author_name FROM script_versions v
         LEFT JOIN users u ON u.id = v.created_by
         WHERE v.script_id = ? ORDER BY v.version DESC LIMIT 50`,
      )
      .all(scriptId) as ScriptVersion[];
  },
};

function saveVersion(
  scriptId: string,
  version: number,
  name: string,
  content: string,
  userId: string | null,
): void {
  db.prepare(
    `INSERT INTO script_versions (id, script_id, version, name, content, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id('ver'), scriptId, version, name, content, userId, now());
}

/* ─────────────────────────  Favoris  ───────────────────────── */

export const favorites = {
  toggle(userId: string, entityType: FavoriteEntity, entityId: string): boolean {
    const existing = db
      .prepare(
        'SELECT id FROM favorites WHERE user_id = ? AND entity_type = ? AND entity_id = ?',
      )
      .get(userId, entityType, entityId) as { id: string } | undefined;
    if (existing) {
      db.prepare('DELETE FROM favorites WHERE id = ?').run(existing.id);
      return false;
    }
    db.prepare(
      'INSERT INTO favorites (id, user_id, entity_type, entity_id, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(id('fav'), userId, entityType, entityId, now());
    return true;
  },
  ids(userId: string, entityType: FavoriteEntity): string[] {
    return (
      db
        .prepare('SELECT entity_id FROM favorites WHERE user_id = ? AND entity_type = ?')
        .all(userId, entityType) as { entity_id: string }[]
    ).map((row) => row.entity_id);
  },
  has(userId: string, entityType: FavoriteEntity, entityId: string): boolean {
    return Boolean(
      db
        .prepare(
          'SELECT 1 FROM favorites WHERE user_id = ? AND entity_type = ? AND entity_id = ?',
        )
        .get(userId, entityType, entityId),
    );
  },
};

/* ─────────────────────────  Modèles enrichis  ───────────────────────── */

interface PerformanceRow {
  usage_count: number;
  converted_count: number;
  revenue_cents: number;
  last_used_at: string | null;
}

export function modelPerformance(modelId: string): ModelPerformance {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS usage_count,
              COALESCE(SUM(converted), 0) AS converted_count,
              COALESCE(SUM(revenue_cents), 0) AS revenue_cents,
              MAX(used_at) AS last_used_at
       FROM script_usage WHERE model_id = ?`,
    )
    .get(modelId) as PerformanceRow;

  const conversion = row.usage_count ? row.converted_count / row.usage_count : 0;
  return {
    usage_count: row.usage_count,
    conversion_rate: Number(conversion.toFixed(3)),
    revenue_cents: row.revenue_cents,
    last_used_at: row.last_used_at,
    score: performanceScore({
      usage_count: row.usage_count,
      conversion_rate: conversion,
      revenue_cents: row.revenue_cents,
    }),
  };
}

export function listModelSummaries(userId: string, includeArchived = false): ModelSummary[] {
  const favoriteIds = new Set(favorites.ids(userId, 'model'));
  return creators.list(includeArchived).map((creator) => ({
    ...creator,
    is_favorite: favoriteIds.has(creator.id),
    script_count: scripts.count(creator.id),
    performance: modelPerformance(creator.id),
  }));
}

export function modelSummary(creatorId: string, userId: string): ModelSummary | null {
  const creator = creators.find(creatorId);
  if (!creator) return null;
  return {
    ...creator,
    is_favorite: favorites.has(userId, 'model', creatorId),
    script_count: scripts.count(creatorId),
    performance: modelPerformance(creatorId),
  };
}

/* ─────────────────────────  Analytics  ───────────────────────── */

export function analytics(userId: string, days = 14): AnalyticsOverview {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS usages,
              COALESCE(SUM(converted), 0) AS converted,
              COALESCE(SUM(revenue_cents), 0) AS revenue
       FROM script_usage WHERE used_at >= ?`,
    )
    .get(since) as { usages: number; converted: number; revenue: number };

  const generationsWeek = (
    db
      .prepare('SELECT COUNT(*) AS n FROM generations WHERE created_at >= ?')
      .get(new Date(Date.now() - 7 * 86_400_000).toISOString()) as { n: number }
  ).n;

  const byDay: { date: string; generations: number; usages: number }[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
    const generations = (
      db.prepare('SELECT COUNT(*) AS n FROM generations WHERE created_at LIKE ?').get(`${day}%`) as {
        n: number;
      }
    ).n;
    const usages = (
      db.prepare('SELECT COUNT(*) AS n FROM script_usage WHERE used_at LIKE ?').get(`${day}%`) as {
        n: number;
      }
    ).n;
    byDay.push({ date: day, generations, usages });
  }

  const topRows = db
    .prepare(
      `${SCRIPT_SELECT}
       WHERE EXISTS (SELECT 1 FROM script_usage u WHERE u.script_id = s.id)
       ORDER BY revenue_cents DESC, usage_count DESC LIMIT 8`,
    )
    .all({ userId }) as ScriptRow[];

  const byCategory = db
    .prepare(
      `SELECT c.label AS category, COUNT(u.id) AS usage_count,
              COALESCE(SUM(u.revenue_cents), 0) AS revenue_cents
       FROM script_usage u
       JOIN scripts s ON s.id = u.script_id
       JOIN script_categories c ON c.id = s.category_id
       WHERE u.used_at >= ?
       GROUP BY c.id ORDER BY usage_count DESC LIMIT 8`,
    )
    .all(since) as { category: string; usage_count: number; revenue_cents: number }[];

  return {
    totals: {
      generations_week: generationsWeek,
      scripts_total: scripts.count(),
      scripts_used_week: totals.usages,
      revenue_cents: totals.revenue,
      conversion_rate: totals.usages ? Number((totals.converted / totals.usages).toFixed(3)) : 0,
    },
    by_day: byDay,
    top_scripts: hydrate(topRows),
    by_category: byCategory,
    models: listModelSummaries(userId),
  };
}
