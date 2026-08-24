import { db } from './index.js';

/**
 * Migrations additives.
 *
 * `schema.sql` crée les tables manquantes (`IF NOT EXISTS`) : il suffit pour une
 * base neuve, mais pas pour ajouter une colonne à une base existante. Ce module
 * complète les tables déjà créées, en s'appuyant sur `PRAGMA table_info` — donc
 * idempotent, exécutable à chaque démarrage, sans jamais toucher aux données.
 *
 * Pour ajouter un champ plus tard : l'ajouter au `CREATE TABLE` de schema.sql
 * **et** dans la liste ci-dessous.
 */
const COLUMNS: { table: string; column: string; definition: string }[] = [
  { table: 'creators', column: 'avatar_url', definition: "TEXT NOT NULL DEFAULT ''" },
  { table: 'creators', column: 'age', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'creators', column: 'content_style', definition: "TEXT NOT NULL DEFAULT ''" },
  { table: 'creators', column: 'custom_instructions', definition: "TEXT NOT NULL DEFAULT ''" },
];

export function applyColumnPatches(): void {
  for (const patch of COLUMNS) {
    const exists = (
      db.prepare(`PRAGMA table_info(${patch.table})`).all() as { name: string }[]
    ).some((column) => column.name === patch.column);
    if (!exists) {
      db.exec(`ALTER TABLE ${patch.table} ADD COLUMN ${patch.column} ${patch.definition}`);
      console.log(`[cadence] migration : ${patch.table}.${patch.column} ajoutée`);
    }
  }
}
