/**
 * http/respond.js — Helpers de réponse HTTP et lecture du corps JSON.
 */

/** Envoie une réponse JSON. */
export function json(res, statut, corps) {
  const charge = JSON.stringify(corps, null, 2);
  res.writeHead(statut, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(charge),
    // Le simulateur est local : on interdit toute mise en cache pour que le
    // dashboard voie toujours l'état réel.
    'Cache-Control': 'no-store',
  });
  res.end(charge);
}

/** Réponse d'erreur normalisée : { error: { code, message } }. */
export function erreur(res, statut, message, code = 'error') {
  json(res, statut, { error: { code, message } });
}

/**
 * Lit et parse le corps JSON d'une requête.
 * Limité à 64 Ko : c'est un outil local, aucune raison d'accepter plus.
 */
export function lireJson(req, limiteOctets = 64 * 1024) {
  return new Promise((resoudre, rejeter) => {
    let taille = 0;
    const morceaux = [];

    req.on('data', (morceau) => {
      taille += morceau.length;
      if (taille > limiteOctets) {
        rejeter(new Error('Corps de requête trop volumineux.'));
        req.destroy();
        return;
      }
      morceaux.push(morceau);
    });

    req.on('end', () => {
      const brut = Buffer.concat(morceaux).toString('utf8').trim();
      if (!brut) return resoudre({});
      try {
        resoudre(JSON.parse(brut));
      } catch {
        rejeter(new Error('Corps de requête JSON invalide.'));
      }
    });

    req.on('error', rejeter);
  });
}
