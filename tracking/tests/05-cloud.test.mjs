// Mode CLOUD : vérifie les requêtes envoyées à Supabase (tables, colonnes,
// propriétaire, suppression logique) avec un client simulé — aucun réseau.
//   node tracking/tests/05-cloud.test.mjs
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, r));
const base = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('dialog', d => d.accept());

await page.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, body: '' }));
await page.addInitScript(() => {
  localStorage.setItem('vm_allow_web', '1');
  localStorage.setItem('valmont_onboarding_v1', JSON.stringify({ lang: 'fr', completedAt: Date.now() }));
  localStorage.setItem('vm_plan', 'elite');
});

await page.goto(base + '/index.html?web=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.VTL);
await page.evaluate(() => {
  ['onboarding', 'login-screen', 'pricing-screen', 'intro'].forEach(id => {
    const e = document.getElementById(id); if (e) e.style.display = 'none';
  });
});

// Client Supabase simulé, installé après le chargement (le script de l'app
// définit son propre window.VMB au démarrage).
await page.evaluate(() => {
  const log = [];
  window.__sb = log;
  const FIX = {
    tl_links: [{
      id: 'L1', owner_id: 'u1', model_id: 'M1', campaign_id: null, name: 'Instagram Bio', slug: 'emma',
      destination_url: 'https://example-platform.com/emma', source_code: 'instagram', status: 'active',
      attribution_window_days: 30, created_at: '2026-08-01T10:00:00Z', deleted_at: null,
      model: { id: 'M1', name: 'Emma' }, campaign: null,
    }],
    tl_link_stats: [{
      link_id: 'L1', clicks: 2732, unique_visitors: 2104, clicks_today: 12, clicks_7d: 300, clicks_30d: 1200,
      conversions: 93, fans: 120, revenue: 8690, conversion_rate: 4.42, revenue_per_visitor: 4.13, revenue_per_fan: 72.42,
    }],
    tl_models: [{ id: 'M1', owner_id: 'u1', name: 'Emma', handle: '@emma', status: 'active', created_at: '2026-07-01T10:00:00Z' }],
    tl_model_stats: [{ model_id: 'M1', links: 1, clicks: 2732, unique_visitors: 2104, fans: 120, revenue: 8690, conversion_rate: 4.42 }],
    tl_campaigns: [{ id: 'C1', owner_id: 'u1', name: 'Summer drop' }],
    tl_link_daily: [{ link_id: 'L1', day: '2026-08-20', clicks: 120, unique_visitors: 90, conversions: 4, revenue: 320 }],
    tl_link_sources: [{ link_id: 'L1', source_code: 'instagram', clicks: 2200 }, { link_id: 'L1', source_code: 'tiktok', clicks: 532 }],
    tl_conversions: [{ id: 'V1', occurred_at: '2026-08-22T10:00:00Z', amount: 49.9, currency: 'USD', source: 'api', status: 'attributed', link_id: 'L1' }],
    tl_ingest_keys: [{ id: 'K1', name: 'Plateforme', prefix: 'vtl_a1b2c3', created_at: '2026-08-01T10:00:00Z', last_used_at: null, revoked_at: null }],
  };

  function builder(table, op, payload) {
    const entry = { table, op, payload, filters: [], columns: null };
    log.push(entry);
    const api = {
      select(cols) { entry.columns = cols || '*'; return api; },
      order(c, o) { entry.filters.push(['order', c, o]); return api; },
      is(c, v) { entry.filters.push(['is', c, v]); return api; },
      eq(c, v) { entry.filters.push(['eq', c, v]); return api; },
      gte(c, v) { entry.filters.push(['gte', c, v]); return api; },
      ilike(c, v) { entry.filters.push(['ilike', c, v]); return api; },
      limit(n) { entry.filters.push(['limit', n]); return api; },
      then(resolve) {
        let data = FIX[table] || [];
        // Les filtres eq/is sont appliqués : le module doit pouvoir vérifier
        // qu'un slug est libre, qu'un lien existe, etc.
        entry.filters.forEach(([kind, col, val]) => {
          if (kind === 'eq') data = data.filter(r => String(r[col]) === String(val));
          if (kind === 'is') data = data.filter(r => (r[col] ?? null) === val);
        });
        if (op === 'insert') data = [Object.assign({ id: 'NEW' }, payload)];
        if (op === 'update') data = [Object.assign({}, (FIX[table] || [{}])[0], payload)];
        if (table === 'tl_campaigns' && entry.filters.some(f => f[0] === 'ilike')) data = [];
        resolve({ data, error: null });
      },
    };
    return api;
  }

  window.VMB = {
    enabled: true,
    schedulePush() {},
    client: {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
      from: table => ({
        select: cols => builder(table, 'select').select(cols),
        insert: p => builder(table, 'insert', p),
        update: p => builder(table, 'update', p),
        delete: () => builder(table, 'delete'),
      }),
      rpc: async (fn, params) => {
        log.push({ rpc: fn, params });
        if (fn === 'tl_create_ingest_key') return { data: { ok: true, id: 'K2', key: 'vtl_' + 'ab'.repeat(24), prefix: 'vtl_ababab' }, error: null };
        if (fn === 'tl_import_conversions') return { data: { ok: true, imported: 2, attributed: 1, duplicates: 0, errors: 0 }, error: null };
        if (fn === 'tl_reattribute_pending') return { data: { ok: true, attributed: 3 }, error: null };
        return { data: null, error: null };
      },
    },
  };
});

let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };
console.log('Mode cloud (client Supabase simulé)');

await test('le module bascule en mode cloud quand une session existe', async () => {
  await page.evaluate(() => VTL.open());
  await page.waitForSelector('#v-tracking.on .vtl-table tbody tr');
  assert.equal(await page.evaluate(() => VTL._internals.currentStore().mode), 'cloud');
  assert.equal(await page.evaluate(() => !!document.querySelector('#v-tracking .vtl-note.warn')), false,
    'aucun bandeau « mode local » ne doit apparaître');
});

await test('les liens et statistiques viennent des bonnes tables', async () => {
  const tables = await page.evaluate(() => window.__sb.filter(e => e.table).map(e => e.table));
  ['tl_links', 'tl_link_stats', 'tl_models', 'tl_model_stats', 'tl_campaigns'].forEach(t =>
    assert.ok(tables.includes(t), 'table absente : ' + t));
  const row = await page.textContent('#v-tracking .vtl-table tbody tr');
  assert.match(row, /Emma/);
  assert.match(row, /2,732/);
  assert.match(row, /2,104/);
  assert.match(row, /4\.42%/);
  assert.match(row, /\$8,690/);
  assert.match(row, /120/);
});

await test('les liens supprimés sont exclus de la requête', async () => {
  // (la première requête sur tl_links est la sonde d'installation du schéma)
  const q = await page.evaluate(() => window.__sb.find(e =>
    e.table === 'tl_links' && e.op === 'select' && /model:tl_models/.test(e.columns || '')));
  assert.ok(q.filters.some(f => f[0] === 'is' && f[1] === 'deleted_at' && f[2] === null));
  assert.match(q.columns, /model:tl_models/);
});

await test('la création envoie owner_id et les champs attendus', async () => {
  await page.click('#v-tracking [data-act="create"]');
  await page.waitForSelector('#vtl-link-modal.open');
  await page.fill('#vtl-m-name', 'TikTok Bio');
  await page.fill('#vtl-m-slug', 'emma-tiktok');
  await page.fill('#vtl-m-dest', 'https://example-platform.com/emma');
  await page.selectOption('#vtl-m-source', 'tiktok');
  await page.selectOption('#vtl-m-window', '14');
  await page.fill('#vtl-m-campaign', 'Automne');
  await page.click('#vtl-m-save');
  await page.waitForFunction(() => window.__sb.some(e => e.table === 'tl_links' && e.op === 'insert'));
  const ins = await page.evaluate(() => window.__sb.find(e => e.table === 'tl_links' && e.op === 'insert').payload);
  assert.equal(ins.owner_id, 'u1');
  assert.equal(ins.slug, 'emma-tiktok');
  assert.equal(ins.source_code, 'tiktok');
  assert.equal(ins.attribution_window_days, 14);
  assert.equal(ins.status, 'active');
  const camp = await page.evaluate(() => window.__sb.find(e => e.table === 'tl_campaigns' && e.op === 'insert'));
  assert.equal(camp.payload.name, 'Automne', 'la campagne doit être créée si elle n’existe pas');
});

await test('la suppression est logique (deleted_at), jamais destructive', async () => {
  await page.evaluate(() => {
    document.querySelector('#v-tracking .vtl-table tbody [data-menu]').click();
  });
  await page.waitForSelector('.vtl-menu.open');
  await page.click('.vtl-menu button[data-a="delete"]');
  await page.waitForFunction(() => window.__sb.some(e => e.table === 'tl_links' && e.op === 'update' && e.payload.deleted_at));
  const del = await page.evaluate(() => window.__sb.filter(e => e.table === 'tl_links' && e.op === 'delete').length);
  assert.equal(del, 0, 'aucune suppression physique ne doit être émise');
});

await test('la page détail interroge les vues analytiques', async () => {
  await page.evaluate(() => window.__sb.length = 0);
  await page.evaluate(() => VTL.openLink('L1'));
  await page.waitForSelector('#v-tracking-link.on .vtl-kpis-lg');
  const tables = await page.evaluate(() => window.__sb.filter(e => e.table).map(e => e.table));
  ['tl_link_daily', 'tl_link_sources', 'tl_conversions'].forEach(t =>
    assert.ok(tables.includes(t), 'vue absente : ' + t));
  const kpis = await page.textContent('#v-tracking-link .vtl-kpis-lg');
  assert.match(kpis, /2,732/); assert.match(kpis, /120/); assert.match(kpis, /\$8,690/); assert.match(kpis, /4\.42%/);
  assert.match(await page.textContent('#v-tracking-link'), /Instagram/);
});

await test('création d’une clé d’ingestion via RPC, affichée une seule fois', async () => {
  await page.evaluate(() => VTL.open());
  await page.waitForSelector('#v-tracking.on');
  await page.click('#v-tracking [data-act="integration"]');
  await page.waitForSelector('#vtl-integration-modal.open');
  await page.fill('#vtl-key-name', 'Plateforme');
  await page.click('#vtl-key-create');
  await page.waitForSelector('#vtl-key-out .vtl-code');
  assert.match(await page.textContent('#vtl-key-out'), /^\s*Copie cette clé maintenant/);
  const rpc = await page.evaluate(() => window.__sb.find(e => e.rpc === 'tl_create_ingest_key'));
  assert.equal(rpc.params.p_name, 'Plateforme');
});

await test('import de conversions via RPC serveur', async () => {
  await page.fill('#vtl-import', 'external_id,slug,amount,currency\ncv_1,emma,49.90,USD\ncv_2,emma,20,USD');
  await page.click('#vtl-import-run');
  await page.waitForFunction(() => window.__sb.some(e => e.rpc === 'tl_import_conversions'));
  const rpc = await page.evaluate(() => window.__sb.find(e => e.rpc === 'tl_import_conversions'));
  assert.equal(rpc.params.p_rows.length, 2);
  assert.equal(rpc.params.p_rows[0].external_id, 'cv_1');
  assert.match(await page.textContent('#vtl-import-out'), /2 importée/);
});

await test('relance d’attribution via RPC', async () => {
  await page.click('#vtl-reattr');
  await page.waitForFunction(() => window.__sb.some(e => e.rpc === 'tl_reattribute_pending'));
  assert.match(await page.textContent('#vtl-import-out'), /3 conversion/);
  await page.click('#vtl-integration-modal [data-close]');
});

await test('schéma absent → repli en mode local avec explication', async () => {
  await page.evaluate(() => {
    window.VMB.client.from = () => ({
      select: () => ({
        limit: () => ({ then: r => r({ data: null, error: { message: 'relation "public.tl_links" does not exist' } }) }),
        is: () => ({ order: () => ({ then: r => r({ data: [], error: null }) }) }),
        order: () => ({ then: r => r({ data: [], error: null }) }),
        eq: () => ({ then: r => r({ data: [], error: null }) }),
        then: r => r({ data: [], error: null }),
      }),
    });
  });
  await page.evaluate(() => VTL.open());
  await page.waitForSelector('#v-tracking.on .vtl-note.warn');
  assert.equal(await page.evaluate(() => VTL._internals.currentStore().mode), 'local');
  assert.match(await page.textContent('#v-tracking .vtl-note.warn'), /schema\.sql/);
});

await test('aucune erreur JavaScript', async () => { assert.deepEqual(errors, []); });

console.log(`\n${n} tests OK`);
await browser.close(); server.close();
