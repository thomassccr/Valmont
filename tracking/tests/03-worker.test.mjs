// Test du Worker de redirection — sans réseau : les appels Supabase sont simulés.
//   node tracking/tests/03-worker.test.mjs
import worker from '../worker.js';
import assert from 'node:assert/strict';

const calls = [];
globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };

const LINK = { link_id: 'lnk-1', destination_url: 'https://sub.example.com/emma?ref=bio', source_code: 'instagram', status: 'active' };

globalThis.fetch = async (url, init) => {
  const fn = String(url).split('/rpc/')[1];
  const body = JSON.parse(init.body);
  calls.push({ fn, body, auth: init.headers.Authorization });
  if (fn === 'tl_resolve') return new Response(JSON.stringify(body.p_slug === 'emma' ? [LINK] : []), { status: 200 });
  if (fn === 'tl_record_click') {
    if (globalThis.__blockClick) await new Promise(r => setTimeout(r, 300));
    return new Response(JSON.stringify([{ destination_url: LINK.destination_url }]), { status: 200 });
  }
  if (fn === 'tl_ingest_conversion') {
    const ok = body.p_key_hash && body.p_payload && body.p_payload.external_id;
    return new Response(JSON.stringify(ok ? { ok: true, id: 'c1', attributed: true } : { ok: false, error: 'external_id_required' }), { status: 200 });
  }
  return new Response('null', { status: 200 });
};

const env = {
  SUPABASE_URL: 'https://db.example.supabase.co',
  SUPABASE_SERVICE_KEY: 'service-key',
  VISITOR_SALT: 'sel',
  APP_ORIGINS: 'https://app.example.com',
};
const waits = [];
const ctx = { waitUntil: (p) => waits.push(p) };
const flush = async () => { await Promise.all(waits.splice(0)); };
const go = (path, init) => worker.fetch(new Request('https://go.example.com' + path, init), env, ctx);

let ok = 0;
const test = async (name, fn) => { await fn(); ok++; console.log('  ✓', name); };

console.log('Worker de redirection');

await test('redirige en 302 vers la destination', async () => {
  const res = await go('/emma');
  assert.equal(res.status, 302);
  assert.equal(new URL(res.headers.get('Location')).pathname, '/emma');
});

await test('pose un cookie visiteur anonyme, HttpOnly + SameSite', async () => {
  const res = await go('/emma');
  const c = res.headers.get('Set-Cookie');
  assert.match(c, /^vtl_vid=[a-f0-9]{32};/);
  assert.match(c, /HttpOnly/); assert.match(c, /SameSite=Lax/); assert.match(c, /Secure/);
});

await test('réutilise le cookie existant sans en reposer un', async () => {
  const res = await go('/emma', { headers: { Cookie: 'vtl_vid=abcdef0123456789abcdef0123456789' } });
  assert.equal(res.headers.get('Set-Cookie'), null);
  await flush();
  const click = calls.filter(c => c.fn === 'tl_record_click').pop();
  assert.equal(click.body.p_visitor_key, 'abcdef0123456789abcdef0123456789');
});

await test('enregistre le clic après la redirection (UTM, source, référent)', async () => {
  calls.length = 0;
  globalThis.__blockClick = true;   // l'écriture en base traîne : la redirection ne doit pas l'attendre
  const t0 = Date.now();
  const res = await go('/emma?utm_source=instagram&utm_campaign=summer&src=instagram', {
    headers: { Referer: 'https://www.instagram.com/emma/', 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' },
  });
  const elapsed = Date.now() - t0;
  assert.equal(res.status, 302);
  assert.ok(elapsed < 100, `la redirection a attendu l'écriture en base (${elapsed} ms)`);
  await flush();
  globalThis.__blockClick = false;
  const click = calls.find(c => c.fn === 'tl_record_click').body;
  assert.equal(click.p_utm.campaign, 'summer');
  assert.equal(click.p_source, 'instagram');
  assert.equal(click.p_referrer_host, 'www.instagram.com');
  assert.equal(click.p_device, 'mobile');
});

await test('ne transmet ni IP ni user-agent à la base', async () => {
  const click = calls.find(c => c.fn === 'tl_record_click');
  const raw = JSON.stringify(click.body);
  assert.ok(!/Mozilla/.test(raw) && !/iPhone/.test(raw), 'user-agent brut transmis');
  assert.ok(!/\d+\.\d+\.\d+\.\d+/.test(raw), 'adresse IP transmise');
});

await test('transmet les UTM à la destination sans écraser ses paramètres', async () => {
  const res = await go('/emma?utm_source=tiktok&ref=pirate');
  const dest = new URL(res.headers.get('Location'));
  assert.equal(dest.searchParams.get('utm_source'), 'tiktok');
  assert.equal(dest.searchParams.get('ref'), 'bio', 'le paramètre de la destination doit primer');
});

await test('slug inconnu → 404', async () => {
  assert.equal((await go('/inconnu')).status, 404);
});

await test('slug invalide → 404 sans appel à la base', async () => {
  calls.length = 0;
  assert.equal((await go('/..%2Fetc%2Fpasswd')).status, 404);
  assert.equal((await go('/UPPER!')).status, 404);
  assert.equal(calls.length, 0);
});

await test('slug inconnu → repli sur FALLBACK_URL si configuré', async () => {
  const res = await worker.fetch(new Request('https://go.example.com/inconnu'),
    { ...env, FALLBACK_URL: 'https://valmont.app' }, ctx);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), 'https://valmont.app');
});

await test('POST sur une redirection → 405', async () => {
  assert.equal((await go('/emma', { method: 'POST' })).status, 405);
});

console.log('API conversions');

const post = (payload, key, extra) => go('/api/conversions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}), ...(extra || {}) },
  body: typeof payload === 'string' ? payload : JSON.stringify(payload),
});
const GOOD_KEY = 'vtl_' + 'a1b2c3d4'.repeat(6);

await test('refuse une requête sans clé', async () => {
  assert.equal((await post({ external_id: 'x' })).status, 401);
});

await test('refuse une clé au mauvais format', async () => {
  assert.equal((await post({ external_id: 'x' }, 'Bearer-nimporte-quoi')).status, 401);
});

await test('accepte une conversion et hache la clé (jamais transmise en clair)', async () => {
  calls.length = 0;
  const res = await post({ external_id: 'cv_1', amount: '49.90', currency: 'USD', fan_id_hash: 'fan_abc123' }, GOOD_KEY);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.accepted, 1);
  assert.equal(body.attributed, 1);
  const call = calls.find(c => c.fn === 'tl_ingest_conversion');
  assert.match(call.body.p_key_hash, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(call.body).includes(GOOD_KEY), 'clé en clair transmise à la base');
});

await test('accepte un lot de conversions', async () => {
  const res = await post([{ external_id: 'a', amount: 1 }, { external_id: 'b', amount: 2 }], GOOD_KEY);
  assert.equal((await res.json()).accepted, 2);
});

await test('refuse un JSON invalide', async () => {
  assert.equal((await post('{pas du json', GOOD_KEY)).status, 400);
});

await test('refuse un lot trop volumineux', async () => {
  const rows = Array.from({ length: 501 }, (_, i) => ({ external_id: 'x' + i, amount: 1 }));
  assert.equal((await post(rows, GOOD_KEY)).status, 413);
});

await test('CORS : origine autorisée uniquement', async () => {
  const good = await post({ external_id: 'c1', amount: 1 }, GOOD_KEY, { Origin: 'https://app.example.com' });
  assert.equal(good.headers.get('Access-Control-Allow-Origin'), 'https://app.example.com');
  const bad = await post({ external_id: 'c2', amount: 1 }, GOOD_KEY, { Origin: 'https://evil.example.com' });
  assert.equal(bad.headers.get('Access-Control-Allow-Origin'), null);
});

await test('health check', async () => {
  const res = await go('/api/health');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

console.log(`\n${ok} tests OK`);
