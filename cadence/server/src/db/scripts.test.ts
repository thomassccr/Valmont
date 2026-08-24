import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

// La base est choisie avant le chargement des modules : `env.ts` lit
// process.env à l'import.
const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cadence-')), 'test.db');
process.env.DATABASE_PATH = dbPath;

const { migrate } = await import('./index.js');
const { scriptCategories, scripts, favorites, modelPerformance } = await import('./scripts.js');
const { creators, users } = await import('./repos.js');
const { patchOf } = await import('../http/schemas.js');
const { scriptSchema } = await import('../http/schemas.js');

migrate();
scriptCategories.ensure({ key: 'ppv', label: 'PPV', sort_order: 10, isSystem: true });
scriptCategories.ensure({ key: 'upsell', label: 'Upsell', sort_order: 20, isSystem: true });

const operator = users.create({
  email: 'test@cadence.local',
  name: 'Test',
  passwordHash: 'x',
  role: 'operator',
});
const emma = creators.create({ name: 'Emma' } as never, operator.id);
const sofia = creators.create({ name: 'Sofia' } as never, operator.id);

after(() => fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }));

/* ─────────  Portée des scripts  ───────── */

test('un script global est visible depuis tous les modèles, sans duplication', () => {
  const global = scripts.create(
    { model_id: null, category_key: 'ppv', name: 'Global PPV', description: '', objective: '', tone: '', trigger: '', content: 'salut', tags: [], variables: [] },
    operator.id,
  );
  const forEmma = scripts.list({ model_id: emma.id, scope: 'all' }, operator.id);
  const forSofia = scripts.list({ model_id: sofia.id, scope: 'all' }, operator.id);
  assert.ok(forEmma.some((script) => script.id === global.id));
  assert.ok(forSofia.some((script) => script.id === global.id));
  assert.equal(scripts.list({ model_id: emma.id, scope: 'model' }, operator.id).length, 0);
});

test('un script de modèle n’apparaît pas chez un autre modèle', () => {
  const owned = scripts.create(
    { model_id: emma.id, category_key: 'ppv', name: 'Emma PPV', description: '', objective: '', tone: '', trigger: '', content: 'hey {{subscriber_name}}', tags: ['ppv'], variables: [] },
    operator.id,
  );
  const forSofia = scripts.list({ model_id: sofia.id, scope: 'all' }, operator.id);
  assert.ok(!forSofia.some((script) => script.id === owned.id));
});

/* ─────────  Mise à jour partielle  ───────── */

test('une mise à jour partielle ne réinitialise pas les champs absents', () => {
  const created = scripts.create(
    { model_id: emma.id, category_key: 'ppv', name: 'À modifier', description: 'desc', objective: 'obj', tone: 'doux', trigger: 'soir', content: 'v1', tags: ['a'], variables: [] },
    operator.id,
  );
  const patch = patchOf(scriptSchema).parse({ content: 'v2' });
  const updated = scripts.update(created.id, patch, operator.id)!;

  assert.equal(updated.content, 'v2');
  assert.equal(updated.model_id, emma.id, 'le script ne doit pas repasser global');
  assert.equal(updated.description, 'desc');
  assert.equal(updated.objective, 'obj');
  assert.deepEqual(updated.tags, ['a']);
  assert.equal(updated.version, 2, 'le changement de contenu crée une version');
});

test('une modification sans changement de contenu ne crée pas de version', () => {
  const created = scripts.create(
    { model_id: null, category_key: 'ppv', name: 'Stable', description: '', objective: '', tone: '', trigger: '', content: 'texte', tags: [], variables: [] },
    operator.id,
  );
  const updated = scripts.update(created.id, { description: 'nouvelle description' }, operator.id)!;
  assert.equal(updated.version, 1);
  assert.equal(scripts.versions(created.id).length, 1);
});

/* ─────────  Duplication  ───────── */

test('la duplication copie le contenu et peut cibler un modèle', () => {
  const source = scripts.create(
    { model_id: null, category_key: 'upsell', name: 'Source', description: '', objective: '', tone: '', trigger: '', content: 'contenu {{price}}', tags: ['x'], variables: [] },
    operator.id,
  );
  const copy = scripts.duplicate(source.id, operator.id, { model_id: sofia.id })!;
  assert.equal(copy.content, source.content);
  assert.equal(copy.model_id, sofia.id);
  assert.deepEqual(copy.tags, ['x']);
  assert.notEqual(copy.id, source.id);
});

/* ─────────  Favoris  ───────── */

test('les favoris sont propres à chaque utilisateur et réversibles', () => {
  const other = users.create({ email: 'b@c.d', name: 'B', passwordHash: 'x', role: 'operator' });
  const script = scripts.create(
    { model_id: null, category_key: 'ppv', name: 'Favori', description: '', objective: '', tone: '', trigger: '', content: 'x', tags: [], variables: [] },
    operator.id,
  );
  assert.equal(favorites.toggle(operator.id, 'script', script.id), true);
  assert.equal(scripts.find(script.id, operator.id)!.is_favorite, true);
  assert.equal(scripts.find(script.id, other.id)!.is_favorite, false);
  assert.equal(favorites.toggle(operator.id, 'script', script.id), false);
  assert.equal(scripts.find(script.id, operator.id)!.is_favorite, false);
});

/* ─────────  Performance  ───────── */

test('usage, conversion et revenu alimentent le score', () => {
  const script = scripts.create(
    { model_id: emma.id, category_key: 'ppv', name: 'Mesuré', description: '', objective: '', tone: '', trigger: '', content: 'x', tags: [], variables: [] },
    operator.id,
  );
  scripts.recordUsage(script.id, operator.id);
  scripts.recordUsage(script.id, operator.id);
  scripts.recordUsage(script.id, operator.id, { converted: true, revenue_cents: 5000 });

  const measured = scripts.find(script.id, operator.id)!;
  assert.equal(measured.usage_count, 3);
  assert.equal(measured.conversion_rate, 0.333);
  assert.equal(measured.revenue_cents, 5000);
  assert.ok(measured.performance_score > 0);
  assert.ok(measured.last_used_at);

  const perf = modelPerformance(emma.id);
  assert.ok(perf.usage_count >= 3);
  assert.ok(perf.revenue_cents >= 5000);
});

/* ─────────  Filtres  ───────── */

test('la recherche et les filtres portent sur le contenu et les tags', () => {
  scripts.create(
    { model_id: null, category_key: 'upsell', name: 'Cherchable', description: '', objective: '', tone: '', trigger: '', content: 'high spender relance', tags: ['high spender'], variables: [] },
    operator.id,
  );
  assert.ok(scripts.list({ search: 'high spender' }, operator.id).length >= 1);
  assert.ok(scripts.list({ tag: 'high-spender' }, operator.id).length >= 1);
  assert.ok(
    scripts
      .list({ category: 'upsell' }, operator.id)
      .every((script) => script.category_key === 'upsell'),
  );
});
