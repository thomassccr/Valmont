/**
 * db/seed.js — Génère le stock de faux comptes du « fournisseur ».
 *
 * Étape 1 du système : avant de pouvoir livrer quoi que ce soit, un panel doit
 * disposer d'un stock. Ici on fabrique ce stock localement, en mémoire puis en
 * base, sans jamais contacter le moindre service extérieur.
 *
 * Exécutable directement :  npm run seed
 */

import path from 'node:path';
import { getDb, transaction } from './index.js';
import { genererFauxUtilisateur } from '../domain/usernames.js';
import { CONFIG } from '../config.js';

/** Nombre de faux comptes actuellement en base. */
export function tailleDuPool() {
  return getDb().prepare('SELECT COUNT(*) AS total FROM fake_users').get().total;
}

/**
 * Complète le stock jusqu'à `cible` faux comptes.
 * Les collisions de pseudos sont simplement ignorées (contrainte UNIQUE) : on
 * boucle jusqu'à atteindre la cible.
 *
 * @param {number} cible taille de stock souhaitée
 * @param {(fait:number, cible:number) => void} [surProgression]
 * @returns {number} nombre de comptes réellement ajoutés
 */
export function remplirLePool(cible = CONFIG.pool.taille, surProgression) {
  const db = getDb();
  const existants = tailleDuPool();
  if (existants >= cible) return 0;

  const inserer = db.prepare(`
    INSERT OR IGNORE INTO fake_users (username, display_name, avatar_seed, quality, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  let total = existants;
  let ajoutes = 0;
  let gardeFou = 0;

  // Insertion par lots dans une transaction : ~40 000 lignes en une poignée
  // de secondes, là où une insertion ligne à ligne prendrait des minutes.
  while (total < cible && gardeFou < 100) {
    gardeFou += 1;
    const manquants = cible - total;

    transaction(() => {
      for (let i = 0; i < manquants; i += 1) {
        const faux = genererFauxUtilisateur();
        const resultat = inserer.run(
          faux.username,
          faux.display_name,
          faux.avatar_seed,
          faux.quality,
          new Date().toISOString(),
        );
        if (resultat.changes > 0) ajoutes += 1;
      }
    });

    total = tailleDuPool();
    surProgression?.(total, cible);
  }

  return ajoutes;
}

// Exécution directe en ligne de commande (`npm run seed`).
if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  const debut = Date.now();
  const ajoutes = remplirLePool(CONFIG.pool.taille, (fait, cible) => {
    process.stdout.write(`\r  ${fait} / ${cible} faux comptes générés…`);
  });
  process.stdout.write('\n');
  console.log(`✔ ${ajoutes} faux comptes ajoutés en ${((Date.now() - debut) / 1000).toFixed(1)}s`);
  console.log(`  Stock total : ${tailleDuPool()} comptes fictifs.`);
}
