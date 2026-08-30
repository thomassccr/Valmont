/**
 * api/stream.controller.js — Flux temps réel (Server-Sent Events).
 *
 * GET /api/stream  ouvre une connexion HTTP qui reste ouverte : le serveur y
 * pousse un message à chaque événement du moteur (progression, chute, fin de
 * commande…). C'est plus économe qu'un rafraîchissement en boucle côté client,
 * et le navigateur se reconnecte tout seul via `EventSource`.
 *
 * `?order=18472` filtre le flux sur une seule commande.
 */

import { souscrire } from '../events.js';

export function flux(req, res, params, url) {
  const filtre = url.searchParams.get('order') ? Number(url.searchParams.get('order')) : null;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  res.write('retry: 2000\n\n');

  const desabonner = souscrire((evenement) => {
    const idCommande = evenement.donnees?.order_id;
    if (filtre !== null && idCommande !== filtre) return;
    res.write(`event: ${evenement.type}\n`);
    res.write(`data: ${JSON.stringify(evenement)}\n\n`);
  });

  // Ping régulier : évite que la connexion soit coupée par inactivité.
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  ping.unref?.();

  req.on('close', () => {
    clearInterval(ping);
    desabonner();
  });
}
