/**
 * db/index.js — Ouverture de la base SQLite locale et exécution du schéma.
 *
 * On utilise `node:sqlite`, intégré à Node 22.5+ : aucune dépendance npm,
 * la base est un simple fichier dans `data/`. On peut l'ouvrir avec n'importe
 * quel visualiseur SQLite pour constater que toutes les données sont fictives.
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../config.js';

let instance = null;

/** Ouvre (et crée si besoin) la base, applique le schéma, renvoie la connexion. */
export function getDb() {
  if (instance) return instance;

  fs.mkdirSync(path.dirname(CONFIG.chemins.baseDeDonnees), { recursive: true });
  const db = new DatabaseSync(CONFIG.chemins.baseDeDonnees);

  // WAL : lectures et écritures simultanées sans blocage (le moteur écrit en
  // continu pendant que le dashboard lit).
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  // Si un autre processus écrit au même moment (le serveur et le script de
  // démonstration lancés ensemble), on patiente au lieu d'échouer aussitôt.
  db.exec('PRAGMA busy_timeout = 5000');

  const dossierCourant = path.dirname(fileURLToPath(import.meta.url));
  const schema = fs.readFileSync(path.join(dossierCourant, 'schema.sql'), 'utf8');
  db.exec(schema);

  instance = db;
  return instance;
}

/** Exécute une fonction dans une transaction (tout ou rien). */
export function transaction(fn) {
  const db = getDb();
  db.exec('BEGIN');
  try {
    const resultat = fn(db);
    db.exec('COMMIT');
    return resultat;
  } catch (erreur) {
    db.exec('ROLLBACK');
    throw erreur;
  }
}

/** Ferme la base (utilisé à l'arrêt du serveur). */
export function closeDb() {
  if (instance) {
    instance.close();
    instance = null;
  }
}
