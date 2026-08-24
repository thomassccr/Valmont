// Non-régression : le module ne doit rien casser dans l'application existante.
//   node tracking/tests/06-non-regression.test.mjs
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

let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };
console.log('Non-régression de l’application existante');

await test('les fonctions globales de l’app sont intactes', async () => {
  const fns = await page.evaluate(() => ['showV', 'toggleSbGroup', 'renderEmployees', 'renderGrowth',
    'renderRoadmap', 'renderCalendar', 'openProfile', 'vmApplyTheme']
    .filter(f => typeof window[f] !== 'function'));
  assert.deepEqual(fns, [], 'fonctions manquantes : ' + fns.join(', '));
});

await test('toutes les vues d’origine répondent encore à showV()', async () => {
  for (const v of ['dashboard', 'home', 'briefing', 'chat', 'risk', 'calendar', 'leaderboard',
                   'employees', 'growth', 'roadmap', 'referrals']) {
    await page.evaluate(id => showV(id), v);
    const on = await page.evaluate(id => {
      const el = document.getElementById('v-' + id);
      return !!el && el.classList.contains('on');
    }, v);
    assert.ok(on, 'vue cassée : ' + v);
  }
});

await test('la navigation app → tracking → app fonctionne dans les deux sens', async () => {
  await page.evaluate(() => VTL.open());
  await page.waitForSelector('#v-tracking.on');
  await page.evaluate(() => { showV('employees'); renderEmployees(); });
  await page.waitForSelector('#v-employees.on');
  assert.equal(await page.evaluate(() => document.getElementById('v-tracking').classList.contains('on')), false);
  assert.ok(await page.evaluate(() => document.querySelectorAll('#emp-tbody tr').length > 0),
    'la table des employés doit toujours se remplir');
  await page.evaluate(() => VTL.open());
  await page.waitForSelector('#v-tracking.on');
});

await test('le module n’écrit que sous les clés vm_tl_*', async () => {
  await page.evaluate(() => VTL.seedDemo());
  await page.waitForFunction(() => VTL._internals.UI.links.length >= 4);
  const keys = await page.evaluate(() => Object.keys(localStorage).filter(k => /^vm_tl_/.test(k)).sort());
  assert.deepEqual(keys, ['vm_tl_campaigns', 'vm_tl_clicks', 'vm_tl_conversions', 'vm_tl_demo', 'vm_tl_links', 'vm_tl_models']);
  const others = await page.evaluate(() => localStorage.getItem('vm_employees'));
  assert.ok(others === null || others.includes('Sarah'), 'les données de l’app ne doivent pas être altérées');
  await page.evaluate(() => VTL.clearDemo());
});

await test('le thème clair de l’app reste fonctionnel', async () => {
  await page.evaluate(() => vmApplyTheme('light'));
  assert.ok(await page.evaluate(() => document.body.classList.contains('theme-light')));
  await page.evaluate(() => { showV('dashboard'); });
  const bg = await page.evaluate(() => getComputedStyle(document.getElementById('v-dashboard')).backgroundColor);
  assert.match(bg, /rgb\(238, 240, 243\)|rgb\(255, 255, 255\)/, 'le thème clair doit encore s’appliquer aux vues d’origine');
  await page.evaluate(() => vmApplyTheme('dark'));
});

await test('les styles du module ne fuient pas hors de ses vues', async () => {
  const leak = await page.evaluate(() => {
    const el = document.createElement('div');
    el.className = 'vtl-card';
    document.getElementById('v-dashboard').appendChild(el);
    const inherited = getComputedStyle(document.getElementById('v-dashboard')).backgroundColor;
    el.remove();
    return inherited;
  });
  assert.ok(!/rgb\(5, 3, 8\)/.test(leak), 'le fond du module ne doit pas s’appliquer au dashboard');
});

await test('aucune erreur JavaScript sur l’ensemble du parcours', async () => {
  assert.deepEqual(errors, []);
});

console.log(`\n${n} tests OK`);
await browser.close(); server.close();
