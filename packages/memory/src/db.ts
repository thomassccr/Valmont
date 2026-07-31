import Database from 'better-sqlite3';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { Logger } from '@valmont/kernel';
import { MIGRATIONS } from './schema.js';

export type Db = Database.Database;

/**
 * Ouverture de la base.
 *
 * SQLite plutôt qu'un serveur : la mémoire d'une personne tient dans un
 * fichier, doit survivre à l'absence de réseau, et ne doit dépendre d'aucun
 * service tiers. Un fichier unique se sauvegarde, se chiffre et se déplace.
 *
 * Réglages retenus :
 *  - `WAL` : lectures concurrentes pendant les écritures (l'interface lit
 *    pendant que les agents de fond écrivent).
 *  - `synchronous = NORMAL` : bon compromis avec WAL, aucune perte sur crash
 *    applicatif (seul un crash système peut coûter la dernière transaction).
 *  - `foreign_keys` : les cascades sont voulues, autant qu'elles s'appliquent.
 */
export function openDatabase(path: string, logger?: Logger): Db {
  mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('temp_store = MEMORY');
  // ~64 Mo de cache : la base tient largement en mémoire pendant des années.
  db.pragma('cache_size = -64000');

  migrate(db, logger);
  return db;
}

function migrate(db: Db, logger?: Logger): void {
  const current = db.pragma('user_version', { simple: true }) as number;

  if (current > MIGRATIONS.length) {
    throw new Error(
      `Base créée par une version plus récente de Valmont (schéma v${current}, ` +
        `binaire v${MIGRATIONS.length}). Mettre à jour l'application plutôt que ` +
        `rétrograder la base.`,
    );
  }

  for (let version = current; version < MIGRATIONS.length; version++) {
    const sql = MIGRATIONS[version];
    if (!sql) continue;
    logger?.info('migration du schéma', { from: version, to: version + 1 });
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.pragma(`user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${version + 1} en échec : ${String(error)}`);
    }
  }
}

/** Sérialisation JSON tolérante — une valeur illisible ne doit pas tout casser. */
export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/** Encode un vecteur en BLOB (little-endian, natif de la plateforme). */
export function encodeVector(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

export function decodeVector(blob: Buffer): Float32Array {
  // Copie explicite : le tampon SQLite peut être réutilisé après la lecture.
  const copy = new ArrayBuffer(blob.byteLength);
  Buffer.from(copy).set(blob);
  return new Float32Array(copy);
}
