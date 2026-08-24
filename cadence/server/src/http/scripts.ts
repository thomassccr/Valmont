import { Router } from 'express';
import type { ScriptFilters } from '../../../shared/types.js';
import { creators, generations, templates } from '../db/repos.js';
import {
  analytics,
  favorites,
  listModelSummaries,
  modelSummary,
  scriptCategories,
  scriptTags,
  scripts,
} from '../db/scripts.js';
import { generateVariations } from '../generation/service.js';
import { asyncRoute, badRequest, notFound, unauthorized } from '../lib/errors.js';
import {
  categorySchema,
  favoriteSchema,
  patchOf,
  scriptSchema,
  scriptUsageSchema,
  variationSchema,
} from './schemas.js';

export const scriptsRouter = Router();

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

const flag = (value: unknown): boolean => value === '1' || value === 'true';

const requireUser = (userId: string | undefined): string => {
  if (!userId) throw unauthorized();
  return userId;
};

/* ─────────────────────────  Catégories & tags  ───────────────────────── */

scriptsRouter.get('/scripts/categories', (_req, res) => {
  res.json(scriptCategories.list());
});

scriptsRouter.post('/scripts/categories', (req, res) => {
  const parsed = categorySchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Catégorie invalide', parsed.error.flatten());
  res.status(201).json(
    scriptCategories.ensure({
      key: parsed.data.key,
      label: parsed.data.label,
      sort_order: parsed.data.sort_order,
      isSystem: false,
    }),
  );
});

scriptsRouter.get('/scripts/tags', (_req, res) => {
  res.json(scriptTags.list());
});

/* ─────────────────────────  Scripts  ───────────────────────── */

scriptsRouter.get('/scripts', (req, res) => {
  const userId = requireUser(req.user?.id);
  const filters: ScriptFilters = {
    model_id: str(req.query.model_id) ?? null,
    scope: (str(req.query.scope) as ScriptFilters['scope']) ?? 'all',
    category: str(req.query.category),
    tag: str(req.query.tag),
    search: str(req.query.search),
    favorites: flag(req.query.favorites),
    recent: flag(req.query.recent),
    limit: Math.min(Number(req.query.limit) || 300, 1000),
  };
  res.json(scripts.list(filters, userId));
});

scriptsRouter.get('/scripts/:id', (req, res) => {
  const script = scripts.find(req.params.id, requireUser(req.user?.id));
  if (!script) throw notFound('Script introuvable');
  res.json(script);
});

scriptsRouter.post('/scripts', (req, res) => {
  const userId = requireUser(req.user?.id);
  const parsed = scriptSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Script invalide', parsed.error.flatten());
  if (parsed.data.model_id && !creators.find(parsed.data.model_id)) {
    throw badRequest('Modèle introuvable');
  }
  if (!scriptCategories.findByKey(parsed.data.category_key)) {
    throw badRequest('Catégorie inconnue');
  }
  res.status(201).json(scripts.create(parsed.data, userId));
});

scriptsRouter.put('/scripts/:id', (req, res) => {
  const userId = requireUser(req.user?.id);
  const parsed = patchOf(scriptSchema).safeParse(req.body);
  if (!parsed.success) throw badRequest('Script invalide', parsed.error.flatten());
  if (parsed.data.category_key && !scriptCategories.findByKey(parsed.data.category_key)) {
    throw badRequest('Catégorie inconnue');
  }
  const updated = scripts.update(req.params.id, parsed.data, userId);
  if (!updated) throw notFound('Script introuvable');
  res.json(updated);
});

scriptsRouter.post('/scripts/:id/duplicate', (req, res) => {
  const userId = requireUser(req.user?.id);
  // Dupliquer vers un modèle : permet de partir d'un script global pour créer
  // une version propre à un modèle, sans toucher à l'original.
  const target = req.body?.model_id === undefined ? {} : { model_id: req.body.model_id as string | null };
  const copy = scripts.duplicate(req.params.id, userId, target);
  if (!copy) throw notFound('Script introuvable');
  res.status(201).json(copy);
});

scriptsRouter.delete('/scripts/:id', (req, res) => {
  if (!scripts.remove(req.params.id)) throw notFound('Script introuvable');
  res.json({ ok: true });
});

scriptsRouter.get('/scripts/:id/versions', (req, res) => {
  res.json(scripts.versions(req.params.id));
});

scriptsRouter.post('/scripts/:id/usage', (req, res) => {
  const userId = requireUser(req.user?.id);
  const parsed = scriptUsageSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw badRequest('Utilisation invalide', parsed.error.flatten());
  if (!scripts.find(req.params.id, userId)) throw notFound('Script introuvable');
  scripts.recordUsage(req.params.id, userId, parsed.data);
  res.json(scripts.find(req.params.id, userId));
});

scriptsRouter.post(
  '/scripts/:id/variations',
  asyncRoute(async (req, res) => {
    if (!req.user) throw unauthorized();
    const parsed = variationSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest('Demande invalide', parsed.error.flatten());
    res.json(await generateVariations(req.params.id, parsed.data, req.user));
  }),
);

/* ─────────────────────────  Modèles (vue enrichie)  ───────────────────────── */

scriptsRouter.get('/models', (req, res) => {
  res.json(listModelSummaries(requireUser(req.user?.id), req.query.archived === '1'));
});

scriptsRouter.get('/models/:id', (req, res) => {
  const summary = modelSummary(req.params.id, requireUser(req.user?.id));
  if (!summary) throw notFound('Modèle introuvable');
  res.json(summary);
});

/* ─────────────────────────  Favoris  ───────────────────────── */

scriptsRouter.post('/favorites/toggle', (req, res) => {
  const userId = requireUser(req.user?.id);
  const parsed = favoriteSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Favori invalide', parsed.error.flatten());
  const active = favorites.toggle(userId, parsed.data.entity_type, parsed.data.entity_id);
  res.json({ is_favorite: active });
});

scriptsRouter.get('/favorites', (req, res) => {
  const userId = requireUser(req.user?.id);
  const generationIds = new Set(favorites.ids(userId, 'generation'));
  res.json({
    scripts: scripts.list({ favorites: true }, userId),
    models: listModelSummaries(userId).filter((model) => model.is_favorite),
    generations: generations.list({ limit: 500 }).filter((item) => generationIds.has(item.id)),
  });
});

/* ─────────────────────────  Analytics  ───────────────────────── */

scriptsRouter.get('/analytics', (req, res) => {
  res.json(analytics(requireUser(req.user?.id)));
});

/* ─────────────────────────  Recherche globale  ───────────────────────── */

scriptsRouter.get('/search', (req, res) => {
  const userId = requireUser(req.user?.id);
  const query = str(req.query.q);
  if (!query) {
    res.json({ models: [], scripts: [], templates: [], generations: [] });
    return;
  }
  const needle = query.toLowerCase();
  res.json({
    models: listModelSummaries(userId, true).filter((model) =>
      `${model.name} ${model.handle} ${model.tone} ${model.audience_type}`
        .toLowerCase()
        .includes(needle),
    ),
    scripts: scripts.list({ search: query, limit: 40 }, userId),
    templates: templates.list({ search: query }).slice(0, 20),
    generations: generations.list({ search: query, limit: 20 }),
  });
});
