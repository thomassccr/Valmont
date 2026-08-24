// ============================================================================
//  VALMONT — Tracking Links : Worker de redirection + API de conversions
//  (Cloudflare Worker — module indépendant du reste de l'application)
// ----------------------------------------------------------------------------
//  Routes :
//    GET  /<slug>              → 302 vers la destination + enregistrement du clic
//    POST /api/conversions     → ingestion des conversions (source autorisée)
//    GET  /api/health          → sonde de disponibilité
//
//  Variables d'environnement (Cloudflare → Settings → Variables) :
//    SUPABASE_URL          (variable)  https://xxxx.supabase.co
//    SUPABASE_SERVICE_KEY  (SECRET)    clé « service_role » — jamais côté client
//    VISITOR_SALT          (SECRET)    sel du hash visiteur sans cookie
//    APP_ORIGINS           (variable)  origines autorisées pour l'API, séparées par des virgules
//    FALLBACK_URL          (variable)  destination si le slug est inconnu (facultatif)
//
//  Vie privée : aucune IP ni user-agent n'est stocké. L'IP et l'UA servent
//  uniquement, en mémoire, à dériver une empreinte anonyme quand le navigateur
//  refuse les cookies — puis sont oubliés.
// ============================================================================

const SLUG_RE = /^[a-z0-9][a-z0-9._-]{1,47}$/;
const COOKIE_NAME = 'vtl_vid';
const RESOLVE_TTL = 60;               // secondes de cache edge pour un slug
const MAX_BODY = 256 * 1024;          // 256 Ko max sur l'API
const MAX_BATCH = 500;                // conversions par appel

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname).replace(/^\/+/, '').replace(/\/+$/, '');

    if (path === 'api/health') {
      return json({ ok: true, service: 'valmont-tracking' }, 200, corsHeaders(request, env));
    }
    if (path === 'api/conversions') {
      if (request.method === 'OPTIONS') return preflight(request, env);
      if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405, corsHeaders(request, env));
      return handleConversions(request, env);
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }
    if (!path || path === 'favicon.ico' || path === 'robots.txt') {
      return path === 'robots.txt'
        ? new Response('User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain' } })
        : notFound(env);
    }
    const slug = path.toLowerCase();
    if (!SLUG_RE.test(slug)) return notFound(env);

    return handleRedirect(request, env, ctx, url, slug);
  },
};

// ─── Redirection ────────────────────────────────────────────────────────────

async function handleRedirect(request, env, ctx, url, slug) {
  const link = await resolveLink(slug, env, ctx);
  if (!link || link.status !== 'active') return notFound(env);

  // Identité anonyme : cookie first-party, sinon empreinte tournante (24 h)
  const cookieId = readCookie(request, COOKIE_NAME);
  const visitorKey = cookieId || (await fallbackVisitorKey(request, env));

  const destination = withPassthroughParams(link.destination_url, url.searchParams);

  const headers = new Headers({
    Location: destination,
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
  });
  if (!cookieId) {
    headers.append(
      'Set-Cookie',
      `${COOKIE_NAME}=${visitorKey}; Path=/; Max-Age=34560000; Secure; HttpOnly; SameSite=Lax`
    );
  }

  // Le clic est enregistré APRÈS l'envoi de la redirection : le visiteur part
  // immédiatement, l'écriture en base ne le ralentit pas.
  ctx.waitUntil(recordClick(env, {
    slug,
    visitorKey,
    source: url.searchParams.get('src') || url.searchParams.get('utm_source') || null,
    utm: {
      source: url.searchParams.get('utm_source'),
      medium: url.searchParams.get('utm_medium'),
      campaign: url.searchParams.get('utm_campaign'),
      content: url.searchParams.get('utm_content'),
      term: url.searchParams.get('utm_term'),
    },
    referrerHost: hostOf(request.headers.get('Referer')),
    country: request.cf && request.cf.country ? String(request.cf.country) : null,
    device: deviceOf(request.headers.get('User-Agent')),
  }));

  return new Response(null, { status: 302, headers });
}

// Résolution du slug, mise en cache à l'edge (une écriture DB par clic, mais
// pas une lecture DB par clic).
async function resolveLink(slug, env, ctx) {
  const cacheKey = new Request(`https://tracking.valmont.internal/resolve/${slug}`, { method: 'GET' });
  const cache = caches.default;

  const hit = await cache.match(cacheKey);
  if (hit) { try { return await hit.json(); } catch (e) { /* cache illisible */ } }

  const rows = await rpc(env, 'tl_resolve', { p_slug: slug });
  const link = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (link) {
    ctx.waitUntil(cache.put(cacheKey, new Response(JSON.stringify(link), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${RESOLVE_TTL}` },
    })));
  }
  return link;
}

async function recordClick(env, c) {
  try {
    await rpc(env, 'tl_record_click', {
      p_slug: c.slug,
      p_visitor_key: c.visitorKey,
      p_source: c.source,
      p_utm: c.utm,
      p_referrer_host: c.referrerHost,
      p_country: c.country,
      p_device: c.device,
    });
  } catch (e) {
    console.log('[tracking] clic non enregistré', e && e.message);
  }
}

// ─── API conversions (source autorisée) ─────────────────────────────────────

async function handleConversions(request, env) {
  const cors = corsHeaders(request, env);
  const auth = request.headers.get('Authorization') || '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!/^vtl_[a-f0-9]{20,}$/.test(key)) {
    return json({ ok: false, error: 'unauthorized' }, 401, cors);
  }

  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > MAX_BODY) return json({ ok: false, error: 'payload_too_large' }, 413, cors);

  let body;
  try { body = await request.json(); }
  catch (e) { return json({ ok: false, error: 'invalid_json' }, 400, cors); }

  const rows = Array.isArray(body) ? body : (Array.isArray(body && body.conversions) ? body.conversions : [body]);
  if (!rows.length) return json({ ok: false, error: 'empty_payload' }, 400, cors);
  if (rows.length > MAX_BATCH) return json({ ok: false, error: 'too_many_rows' }, 413, cors);

  const keyHash = await sha256Hex(key);
  const results = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') { results.push({ ok: false, error: 'invalid_row' }); continue; }
    try {
      const res = await rpc(env, 'tl_ingest_conversion', { p_key_hash: keyHash, p_payload: row });
      results.push(res || { ok: false, error: 'no_response' });
    } catch (e) {
      results.push({ ok: false, error: 'server_error' });
    }
  }

  if (results.length && results.every(r => r && r.error === 'unauthorized')) {
    return json({ ok: false, error: 'unauthorized' }, 401, cors);
  }
  const accepted = results.filter(r => r && r.ok && !r.duplicate).length;
  const duplicates = results.filter(r => r && r.duplicate).length;
  const attributed = results.filter(r => r && r.attributed).length;
  return json({ ok: true, received: rows.length, accepted, duplicates, attributed, results }, 200, cors);
}

// ─── Accès Supabase (clé service_role, jamais exposée au navigateur) ────────

async function rpc(env, fn, params) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    throw new Error('backend_not_configured');
  }
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`rpc_${fn}_${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ─── Utilitaires ────────────────────────────────────────────────────────────

function withPassthroughParams(destination, incoming) {
  try {
    const dest = new URL(destination);
    for (const [k, v] of incoming) {
      // On transmet les UTM et le paramètre src, sans écraser ceux de la destination
      if ((/^utm_/.test(k) || k === 'src') && !dest.searchParams.has(k)) {
        dest.searchParams.append(k, v.slice(0, 120));
      }
    }
    return dest.toString();
  } catch (e) {
    return destination;
  }
}

function readCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  const m = raw.match(new RegExp('(?:^|;\\s*)' + name + '=([A-Za-z0-9_-]{16,64})'));
  return m ? m[1] : null;
}

// Empreinte anonyme de secours : hash tournant sur 24 h.
// L'IP et l'UA ne sortent jamais du Worker et ne sont jamais stockés.
async function fallbackVisitorKey(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const ua = request.headers.get('User-Agent') || '';
  const day = new Date().toISOString().slice(0, 10);
  const salt = env.VISITOR_SALT || 'valmont-tracking';
  if (!ip && !ua) return crypto.randomUUID().replace(/-/g, '');
  return (await sha256Hex(`${salt}|${day}|${ip}|${ua}`)).slice(0, 32);
}

async function sha256Hex(input) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function hostOf(referer) {
  if (!referer) return null;
  try { return new URL(referer).hostname.toLowerCase().slice(0, 120); } catch (e) { return null; }
}

// Catégorie d'appareil grossière : aucun user-agent n'est conservé.
function deviceOf(ua) {
  if (!ua) return 'other';
  const s = ua.toLowerCase();
  if (/ipad|tablet|playbook|silk/.test(s)) return 'tablet';
  if (/mobi|android|iphone|ipod/.test(s)) return 'mobile';
  if (/windows|macintosh|x11|linux|cros/.test(s)) return 'desktop';
  return 'other';
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.APP_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const h = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function preflight(request, env) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

function json(payload, status, headers) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...(headers || {}) },
  });
}

function notFound(env) {
  if (env.FALLBACK_URL) {
    return new Response(null, { status: 302, headers: { Location: env.FALLBACK_URL, 'Cache-Control': 'no-store' } });
  }
  return new Response('Lien introuvable', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
