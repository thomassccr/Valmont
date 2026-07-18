// ============================================================
//  VALMONT — Proxy IA sécurisé (Cloudflare Worker)
// ------------------------------------------------------------
//  Rôle : recevoir les demandes du coach IA de l'app Valmont,
//  ajouter la clé Groq (stockée en SECRET côté serveur, jamais
//  dans l'app), puis transmettre la demande à Groq et renvoyer
//  la réponse. La clé n'apparaît donc plus jamais dans le code
//  public du site.
//
//  La clé se configure dans Cloudflare comme variable secrète
//  nommée  GROQ_KEY  (voir le guide SECURISER-IA.md).
// ============================================================

// Domaines autorisés à utiliser le proxy.
// (empêche que n'importe quel site abuse de ta clé)
const ALLOWED_ORIGINS = [
  'https://thomassccr.github.io', // le site Valmont (GitHub Pages)
  'null',                          // l'app Mac (Electron, fichier local)
  'http://localhost',              // tests en local
  'http://127.0.0.1',
];

function corsHeaders(origin) {
  // Si l'origine est autorisée on la renvoie, sinon on renvoie la 1re de la liste.
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    // Pré-vérification CORS envoyée par le navigateur
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // On n'accepte que le POST
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: corsHeaders(origin),
      });
    }

    // Sécurité : la clé doit être configurée côté serveur
    if (!env.GROQ_KEY) {
      return new Response(
        JSON.stringify({ error: { message: 'GROQ_KEY manquante côté serveur' } }),
        { status: 500, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } }
      );
    }

    // On transmet le corps de la requête tel quel à Groq,
    // en ajoutant la clé secrète.
    const body = await request.text();
    const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.GROQ_KEY}`,
      },
      body,
    });

    // On renvoie la réponse de Groq (le streaming passe directement),
    // en ajoutant les en-têtes CORS.
    const headers = new Headers(corsHeaders(origin));
    const ct = groqResp.headers.get('Content-Type');
    if (ct) headers.set('Content-Type', ct);

    return new Response(groqResp.body, {
      status: groqResp.status,
      headers,
    });
  },
};
