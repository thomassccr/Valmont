/**
 * db/reset.js — Efface toutes les commandes (et repart d'un stock neuf).
 *
 *   npm run reset            -> vide les commandes, garde les faux comptes
 *   npm run reset -- --tout  -> vide aussi le stock de faux comptes
 */

import path from 'node:path';
import { getDb, transaction } from './index.js';

/** Supprime commandes, livraisons et journal. */
export function reinitialiserCommandes() {
  transaction((db) => {
    db.exec('DELETE FROM order_events');
    db.exec('DELETE FROM deliveries');
    db.exec('DELETE FROM orders');
  });
}

/** Supprime en plus tout le stock de faux comptes. */
export function reinitialiserTout() {
  reinitialiserCommandes();
  transaction((db) => db.exec('DELETE FROM fake_users'));
}

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  const tout = process.argv.includes('--tout');
  if (tout) {
    reinitialiserTout();
    console.log('✔ Commandes et stock de faux comptes effacés.');
  } else {
    reinitialiserCommandes();
    console.log('✔ Commandes effacées (le stock de faux comptes est conservé).');
  }
  getDb().close();
}
