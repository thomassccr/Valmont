/**
 * api/routes.js — Table de routage : le seul endroit où l'on voit toute
 * l'API du faux fournisseur d'un coup d'œil.
 */

import { creerRouteur } from '../http/router.js';
import * as orders from './orders.controller.js';
import { flux } from './stream.controller.js';

export function construireRouteur() {
  const routeur = creerRouteur();

  // --- API « fournisseur » (le cœur du cahier des charges) ---
  routeur.post('/api/order', orders.creer); //            créer une commande
  routeur.get('/api/order/:id', orders.detail); //        suivre une commande
  routeur.get('/api/orders', orders.lister); //           lister les commandes

  // --- Routes de compréhension / manipulation ---
  routeur.get('/api/order/:id/followers', orders.abonnes);
  routeur.get('/api/order/:id/events', orders.journal);
  routeur.post('/api/order/:id/cancel', orders.annuler);
  routeur.post('/api/order/:id/drop', orders.chute); //   simuler une chute
  routeur.post('/api/order/:id/refill', orders.refill); // remplacement

  // --- Divers ---
  routeur.get('/api/stats', orders.stats);
  routeur.get('/api/config', orders.config);
  routeur.get('/api/stream', flux); //                    temps réel (SSE)

  return routeur;
}
