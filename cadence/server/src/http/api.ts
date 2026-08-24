import { Router } from 'express';
import { SCENARIO_CATEGORY_LABELS } from '../../../shared/scenarios.js';
import { VARIABLE_CATALOG } from '../../../shared/variables.js';
import {
  creators,
  dashboardStats,
  generations,
  scenarios,
  templates,
} from '../db/repos.js';
import { generate, preview } from '../generation/service.js';
import { DEFAULT_TEMPLATE_BODY } from '../generation/prompt.js';
import { asyncRoute, badRequest, forbidden, notFound } from '../lib/errors.js';
import { requireAdmin, requireAuth } from './auth.js';
import { scriptsRouter } from './scripts.js';
import {
  creatorSchema,
  feedbackSchema,
  generationSchema,
  patchOf,
  previewSchema,
  scenarioSchema,
  templateSchema,
} from './schemas.js';

export const apiRouter = Router();
apiRouter.use(requireAuth);

// Scripts, modèles enrichis, favoris, analytics et recherche globale.
apiRouter.use(scriptsRouter);

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

/* ─────────────────────────  Créateurs  ───────────────────────── */

apiRouter.get('/creators', (req, res) => {
  res.json(creators.list(req.query.archived === '1'));
});

apiRouter.get('/creators/:id', (req, res) => {
  const creator = creators.find(req.params.id);
  if (!creator) throw notFound('Créateur introuvable');
  res.json(creator);
});

apiRouter.post('/creators', (req, res) => {
  const parsed = creatorSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Fiche créateur invalide', parsed.error.flatten());
  res.status(201).json(creators.create(parsed.data as never, req.user?.id ?? null));
});

apiRouter.put('/creators/:id', (req, res) => {
  const parsed = creatorSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Fiche créateur invalide', parsed.error.flatten());
  const updated = creators.update(req.params.id, parsed.data as never);
  if (!updated) throw notFound('Créateur introuvable');
  res.json(updated);
});

apiRouter.delete('/creators/:id', requireAdmin, (req, res) => {
  if (!creators.remove(req.params.id)) throw notFound('Créateur introuvable');
  res.json({ ok: true });
});

/* ─────────────────────────  Scénarios  ───────────────────────── */

apiRouter.get('/scenarios', (_req, res) => {
  res.json({ scenarios: scenarios.list(), categories: SCENARIO_CATEGORY_LABELS });
});

apiRouter.post('/scenarios', (req, res) => {
  const parsed = scenarioSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Scénario invalide', parsed.error.flatten());
  if (scenarios.findByKey(parsed.data.key)) throw badRequest('Cette clé de scénario existe déjà');
  res.status(201).json(scenarios.create(parsed.data as never));
});

apiRouter.put('/scenarios/:id', (req, res) => {
  const parsed = patchOf(scenarioSchema).safeParse(req.body);
  if (!parsed.success) throw badRequest('Scénario invalide', parsed.error.flatten());
  const updated = scenarios.update(req.params.id, parsed.data as never);
  if (!updated) throw notFound('Scénario introuvable');
  res.json(updated);
});

apiRouter.delete('/scenarios/:id', (req, res) => {
  const scenario = scenarios.find(req.params.id);
  if (!scenario) throw notFound('Scénario introuvable');
  if (scenario.is_system) throw forbidden('Les scénarios livrés avec l’outil ne sont pas supprimables');
  scenarios.remove(req.params.id);
  res.json({ ok: true });
});

/* ─────────────────────────  Templates  ───────────────────────── */

apiRouter.get('/templates', (req, res) => {
  res.json(
    templates.list({
      search: str(req.query.search),
      category: str(req.query.category),
      scenarioId: str(req.query.scenario_id),
      creatorId: str(req.query.creator_id),
    }),
  );
});

apiRouter.get('/templates/categories', (_req, res) => {
  res.json(templates.categories());
});

apiRouter.get('/templates/default-body', (_req, res) => {
  res.json({ body: DEFAULT_TEMPLATE_BODY });
});

apiRouter.get('/templates/:id', (req, res) => {
  const template = templates.find(req.params.id);
  if (!template) throw notFound('Template introuvable');
  res.json(template);
});

apiRouter.post('/templates', (req, res) => {
  const parsed = templateSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Template invalide', parsed.error.flatten());
  res.status(201).json(templates.create(parsed.data as never, req.user?.id ?? null));
});

apiRouter.put('/templates/:id', (req, res) => {
  const parsed = patchOf(templateSchema).safeParse(req.body);
  if (!parsed.success) throw badRequest('Template invalide', parsed.error.flatten());
  const updated = templates.update(req.params.id, parsed.data as never);
  if (!updated) throw notFound('Template introuvable');
  res.json(updated);
});

apiRouter.post('/templates/:id/duplicate', (req, res) => {
  const source = templates.find(req.params.id);
  if (!source) throw notFound('Template introuvable');
  const copy = templates.create(
    {
      ...source,
      name: `${source.name} (copie)`,
      is_favorite: false,
    },
    req.user?.id ?? null,
  );
  res.status(201).json(copy);
});

apiRouter.delete('/templates/:id', (req, res) => {
  if (!templates.remove(req.params.id)) throw notFound('Template introuvable');
  res.json({ ok: true });
});

/* ─────────────────────────  Génération  ───────────────────────── */

apiRouter.post(
  '/generate',
  asyncRoute(async (req, res) => {
    const parsed = generationSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Requête de génération invalide', parsed.error.flatten());
    res.json(await generate(parsed.data as never, req.user ?? null));
  }),
);

apiRouter.post('/preview', (req, res) => {
  const parsed = previewSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Aperçu impossible', parsed.error.flatten());
  res.json(preview(parsed.data as never, req.user ?? null));
});

/* ─────────────────────────  Historique  ───────────────────────── */

apiRouter.get('/generations', (req, res) => {
  res.json(
    generations.list({
      creatorId: str(req.query.creator_id),
      operatorId: str(req.query.operator_id),
      search: str(req.query.search),
      limit: Math.min(Number(req.query.limit) || 100, 500),
    }),
  );
});

apiRouter.get('/generations/:id', (req, res) => {
  const item = generations.find(req.params.id);
  if (!item) throw notFound('Génération introuvable');
  res.json(item);
});

apiRouter.post('/generations/:id/feedback', (req, res) => {
  const parsed = feedbackSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Retour invalide', parsed.error.flatten());
  if (!generations.feedback(req.params.id, parsed.data)) throw notFound('Génération introuvable');
  res.json({ ok: true });
});

/* ─────────────────────────  Divers  ───────────────────────── */

apiRouter.get('/variables', (_req, res) => {
  res.json(VARIABLE_CATALOG);
});

apiRouter.get('/stats', (_req, res) => {
  res.json(dashboardStats());
});
