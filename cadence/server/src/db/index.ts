import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../env.js';
import { applyColumnPatches } from './migrations.js';

const here = path.dirname(fileURLToPath(import.meta.url));

fs.mkdirSync(path.dirname(env.databasePath), { recursive: true });

export const db = new Database(env.databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/** Applique le schéma (idempotent, `IF NOT EXISTS` partout). */
export function migrate(): void {
  const schemaPath = [
    path.join(here, 'schema.sql'),                        // dev (tsx) et build (schema copié)
    path.join(here, '../../../../src/db/schema.sql'),     // filet de sécurité depuis dist/
  ].find((candidate) => fs.existsSync(candidate));

  if (!schemaPath) throw new Error('schema.sql introuvable');
  db.exec(fs.readFileSync(schemaPath, 'utf8'));
  applyColumnPatches();
}

/** Helpers JSON : les colonnes `_json` sont stockées en TEXT. */
export const json = {
  parse<T>(raw: string | null | undefined, fallback: T): T {
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },
  stringify(value: unknown): string {
    return JSON.stringify(value ?? null);
  },
};

export const bool = (v: unknown): boolean => v === 1 || v === true;
export const flag = (v: boolean | undefined): number => (v ? 1 : 0);
