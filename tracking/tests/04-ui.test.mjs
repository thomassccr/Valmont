// Test d'interface du module Tracking Links, dans un vrai navigateur.
//   node tracking/tests/04-ui.test.mjs
// (mode local : aucun backend requis)
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]) === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, r));
const base = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
// Les confirmations natives (suppression, chargement de la démo) sont acceptées.
page.on('dialog', d => d.accept());
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error' && !/favicon|supabase|net::ERR/i.test(m.text())) errors.push(m.text()); });

// On coupe le backend cloud : le test valide le mode local, sans réseau.
await page.addInitScript(() => {
  window.VALMONT_BACKEND = {};
  localStorage.setItem('vm_allow_web', '1');
  // On passe l'onboarding et l'écran de tarifs : ils masquent l'application.
  localStorage.setItem('valmont_onboarding_v1', JSON.stringify({ lang: 'fr', completedAt: Date.now() }));
  localStorage.setItem('vm_plan', 'elite');
});
await page.goto(base + '/index.html?web=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.VTL, null, { timeout: 15000 });
// Les écrans d'accueil (login, tarifs) restent au-dessus : on les neutralise
// pour tester le module lui-même, sans modifier l'application.
await page.evaluate(() => {
  ['onboarding', 'login-screen', 'pricing-screen', 'intro'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  document.querySelectorAll('.login-wrap, #intro-canvas').forEach(el => (el.style.display = 'none'));
});

let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };

console.log('Module Tracking Links (navigateur)');

await test('le module s’initialise sans toucher aux vues existantes', async () => {
  const views = await page.evaluate(() => ['v-tracking', 'v-tracking-link', 'v-tracking-models', 'v-tracking-model']
    .map(id => !!document.getElementById(id)));
  assert.deepEqual(views, [true, true, true, true]);
  assert.equal(await page.evaluate(() => !!document.getElementById('v-dashboard')), true);
  assert.equal(await page.evaluate(() => !!document.getElementById('v-employees')), true);
});

await test('la page Tracking Links s’ouvre avec un état vide explicite', async () => {
  await page.evaluate(() => VTL.open());
  await page.waitForSelector('#v-tracking.on .vtl-title');
  assert.match(await page.textContent('#v-tracking .vtl-title'), /Tracking Links/);
  assert.match(await page.textContent('#v-tracking .vtl-empty h3'), /Aucun lien de tracking/);
  assert.match(await page.textContent('#v-tracking .vtl-note'), /Mode local/);
});

await test('les fonctions pures valident slugs et destinations', async () => {
  const r = await page.evaluate(() => {
    const v = VTL._internals;
    return {
      reserved: v.validateSlug('api'), bad: v.validateSlug('Emma!'), good: v.validateSlug('emma'),
      localhost: v.validateDestination('http://localhost:3000/x'),
      priv: v.validateDestination('http://192.168.1.10/x'),
      js: v.validateDestination('javascript:alert(1)'),
      ok: v.validateDestination('https://example-platform.com/emma'),
      slugified: v.slugify('  Émma Rôse !! '),
    };
  });
  assert.ok(r.reserved && r.bad && r.localhost && r.priv && r.js, 'une entrée invalide a été acceptée');
  assert.equal(r.good, null);
  assert.equal(r.ok, null);
  assert.equal(r.slugified, 'emma-rose');
});

await test('création d’un lien via le modal', async () => {
  await page.click('#v-tracking [data-act="create"]');
  await page.waitForSelector('#vtl-link-modal.open');
  await page.selectOption('#vtl-m-model', '__new');
  await page.fill('#vtl-m-model-new', 'Emma');
  await page.fill('#vtl-m-name', 'Instagram Bio');
  await page.fill('#vtl-m-dest', 'https://example-platform.com/emma');
  assert.equal(await page.inputValue('#vtl-m-slug'), 'emma', 'le slug doit être proposé automatiquement');
  await page.fill('#vtl-m-campaign', 'Summer drop');
  await page.click('#vtl-m-save');
  await page.waitForSelector('#v-tracking .vtl-table tbody tr');
  const row = await page.textContent('#v-tracking .vtl-table tbody tr');
  assert.match(row, /Emma/);
  assert.match(row, /\/emma/);
  assert.match(row, /Active/);
});

await test('un slug déjà pris est refusé', async () => {
  await page.click('#v-tracking [data-act="create"]');
  await page.waitForSelector('#vtl-link-modal.open');
  await page.fill('#vtl-m-name', 'Doublon');
  await page.fill('#vtl-m-slug', 'emma');
  await page.fill('#vtl-m-dest', 'https://example-platform.com/x');
  await page.click('#vtl-m-save');
  await page.waitForSelector('#vtl-m-err.on');
  assert.match(await page.textContent('#vtl-m-err'), /déjà utilisé/);
  await page.click('#vtl-link-modal [data-close]');
});

await test('une destination interdite est refusée par le modal', async () => {
  await page.click('#v-tracking [data-act="create"]');
  await page.waitForSelector('#vtl-link-modal.open');
  await page.fill('#vtl-m-name', 'Interne');
  await page.fill('#vtl-m-slug', 'interne');
  await page.fill('#vtl-m-dest', 'http://127.0.0.1:8080/admin');
  assert.equal(await page.inputValue('#vtl-m-dest'), 'http://127.0.0.1:8080/admin');
  await page.click('#vtl-m-save');
  await page.waitForSelector('#vtl-m-err.on');
  assert.match(await page.textContent('#vtl-m-err'), /interdit/);
  await page.click('#vtl-link-modal [data-close]');
});

await test('aucun revenu ni fan n’est inventé sans source de conversion', async () => {
  const kpis = await page.textContent('#v-tracking .vtl-kpis');
  assert.match(kpis, /Revenue attributed[\s\S]*—/);
  assert.match(kpis, /En attente d’une source de conversion/);
});

await test('jeu de démonstration : chargé uniquement à la demande, étiqueté DEMO', async () => {
  await page.evaluate(() => VTL.seedDemo());
  await page.waitForFunction(() => document.querySelectorAll('#v-tracking .vtl-table tbody tr').length >= 5);
  assert.match(await page.textContent('#v-tracking .vtl-table tbody'), /DEMO/);
  const clicks = await page.evaluate(() => VTL._internals.UI.links.reduce((a, l) => a + l.stats.clicks, 0));
  assert.ok(clicks > 1000, 'les données de démonstration doivent produire des clics');
});

await test('recherche et filtres', async () => {
  await page.fill('#vtl-q', 'sofia');
  await page.waitForFunction(() => [...document.querySelectorAll('#v-tracking .vtl-table tbody tr')]
    .every(tr => /sofia/i.test(tr.textContent)));
  const rows = await page.locator('#v-tracking .vtl-table tbody tr').count();
  assert.ok(rows >= 1 && rows <= 3, 'la recherche doit réduire la liste');
  await page.fill('#vtl-q', '');
  await page.waitForFunction(() => document.querySelectorAll('#v-tracking .vtl-table tbody tr').length >= 5);
  await page.selectOption('#vtl-f-source', 'tiktok');
  await page.waitForFunction(() => [...document.querySelectorAll('#v-tracking .vtl-table tbody tr')].length === 1);
  await page.selectOption('#vtl-f-source', '');
  await page.waitForFunction(() => document.querySelectorAll('#v-tracking .vtl-table tbody tr').length >= 5);
});

await test('tri par revenu décroissant', async () => {
  await page.selectOption('#vtl-sort', 'revenue');
  await page.waitForTimeout(150);
  const order = await page.evaluate(() => [...document.querySelectorAll('#v-tracking .vtl-table tbody tr')]
    .map(tr => Number((tr.children[6].textContent || '').replace(/[^0-9.]/g, '')) || 0));
  const sorted = order.slice().sort((a, b) => b - a);
  assert.deepEqual(order, sorted);
});

await test('page détail : 4 statistiques, graphique et sources de trafic', async () => {
  await page.click('#v-tracking .vtl-table tbody tr');
  await page.waitForSelector('#v-tracking-link.on .vtl-kpis-lg');
  const labels = await page.$$eval('#v-tracking-link .vtl-kpis-lg .vtl-kpi-label', els => els.map(e => e.textContent.trim()));
  assert.deepEqual(labels, ['Clicks', 'Fans', 'Revenue', 'Conversion rate']);
  assert.ok(await page.$('#vtl-chart svg path'), 'le graphique doit être tracé');
  assert.match(await page.textContent('#v-tracking-link .vtl-card'), /Performance/);
  assert.match(await page.textContent('#v-tracking-link'), /Traffic sources/);
  assert.match(await page.textContent('#v-tracking-link'), /Revenue attributed/);
});

await test('sélecteur 7D / 30D / 90D / All time et métriques', async () => {
  const pts = async () => page.evaluate(() => VTL._internals.UI.detail.range);
  await page.click('#v-tracking-link [data-range="7"]');
  await page.waitForFunction(() => VTL._internals.UI.detail.range === 7);
  assert.equal(await pts(), 7);
  await page.click('#v-tracking-link [data-range="0"]');
  await page.waitForFunction(() => VTL._internals.UI.detail.range === 0);
  await page.click('#v-tracking-link [data-metric="revenue"]');
  await page.waitForFunction(() => VTL._internals.UI.detail.metric === 'revenue');
  assert.ok(await page.$('#vtl-chart svg'));
});

await test('liste des conversions attribuées, sans donnée personnelle', async () => {
  const table = await page.textContent('#v-tracking-link .vtl-card:last-of-type');
  assert.match(table, /Conversions/);
  const html = await page.innerHTML('#v-tracking-link');
  assert.ok(!/fan_[0-9a-f]{6}/.test(html), 'aucun identifiant de fan ne doit être affiché');
});

await test('actions du lien : pause puis réactivation', async () => {
  await page.click('#v-tracking-link [data-a="toggle"]');
  await page.waitForSelector('#v-tracking-link .vtl-pill.paused');
  await page.click('#v-tracking-link [data-a="toggle"]');
  await page.waitForSelector('#v-tracking-link .vtl-pill.active');
});

await test('duplication d’un lien', async () => {
  const before = await page.evaluate(() => VTL._internals.UI.links.length);
  await page.click('#v-tracking-link [data-a="duplicate"]');
  await page.waitForFunction(b => VTL._internals.UI.links.length === b + 1, before);
  const copy = await page.evaluate(() => VTL._internals.UI.links.find(l => /copie/.test(l.name)));
  assert.equal(copy.status, 'paused', 'une copie doit arriver en pause');
  assert.match(copy.slug, /-copy$/);
});

await test('page modèle : uniquement les liens de cette modèle', async () => {
  await page.evaluate(() => VTL.openModels());
  await page.waitForSelector('#v-tracking-models.on .vtl-model-card');
  const cards = await page.locator('#v-tracking-models .vtl-model-card').count();
  assert.ok(cards >= 2);
  const modelId = await page.getAttribute('#v-tracking-models .vtl-model-card', 'data-model');
  await page.click('#v-tracking-models .vtl-model-card');
  await page.waitForSelector('#v-tracking-model.on .vtl-table tbody tr');
  const rows = await page.$$eval('#v-tracking-model .vtl-table tbody tr', els => els.length);
  const owned = await page.evaluate(id => VTL._internals.UI.links.filter(l => l.model_id === id).length, modelId);
  assert.equal(rows, owned);
  assert.ok(owned >= 1);
  assert.match(await page.textContent('#v-tracking-model'), /Tracking Links/);
});

await test('modal Attribution & API : contrat de données affiché', async () => {
  await page.evaluate(() => VTL.open());
  await page.waitForSelector('#v-tracking.on');
  await page.click('#v-tracking [data-act="integration"]');
  await page.waitForSelector('#vtl-integration-modal.open');
  const txt = await page.textContent('#vtl-integration-modal');
  ['external_id', 'tracking_link_id', 'fan_id_hash', 'amount', 'currency', 'created_at'].forEach(f =>
    assert.ok(txt.includes(f), 'champ manquant dans le contrat : ' + f));
  assert.match(txt, /source autorisée/);
  await page.click('#vtl-integration-modal [data-close]');
});

await test('import CSV : analyse des colonnes', async () => {
  const r = await page.evaluate(() => VTL._internals.parseConversions(
    'external_id,slug,fan_id_hash,amount,currency,created_at\ncv_1,emma,ab12cd34ef,49.90,USD,2026-08-24T10:12:00Z'));
  assert.equal(r.length, 1);
  assert.equal(r[0].external_id, 'cv_1');
  assert.equal(r[0].amount, '49.90');
  const bad = await page.evaluate(() => { try { VTL._internals.parseConversions('a,b\n1,2'); return null; } catch (e) { return e.message; } });
  assert.match(bad, /external_id/);
});

await test('suppression d’un lien', async () => {
  const before = await page.evaluate(() => VTL._internals.UI.links.length);
  await page.evaluate(() => {
    const id = VTL._internals.UI.links.find(l => /copie/.test(l.name)).id;
    return VTL._internals.UI.links.length && document.querySelector(`[data-menu="${id}"]`).click();
  });
  await page.waitForSelector('.vtl-menu.open');
  await page.click('.vtl-menu button[data-a="delete"]');
  await page.waitForFunction(b => VTL._internals.UI.links.length === b - 1, before);
});

await test('les données de démonstration se retirent complètement', async () => {
  await page.evaluate(() => VTL.clearDemo());
  await page.waitForFunction(() => VTL._internals.UI.links.every(l => !l.demo));
  const left = await page.evaluate(() => VTL._internals.UI.links.length);
  assert.equal(left, 1, 'seul le lien créé à la main doit rester');
});

await test('aucune erreur JavaScript pendant tout le parcours', async () => {
  assert.deepEqual(errors, []);
});

console.log(`\n${n} tests OK`);
await browser.close();
server.close();
