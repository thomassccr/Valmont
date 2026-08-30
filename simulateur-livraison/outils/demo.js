/**
 * outils/demo.js — Démonstration commentée, sans navigateur.
 *
 * Rejoue tout le cycle de vie d'une commande directement sur la couche métier
 * (sans passer par HTTP) : création, file d'attente, livraison progressive,
 * chute, remplacement, clôture. Utile pour comprendre le mécanisme en lisant
 * simplement la sortie du terminal.
 *
 *   node outils/demo.js [quantite] [vitesse]
 *   node outils/demo.js 2000 rapide
 */

import { getDb, closeDb } from '../src/db/index.js';
import { remplirLePool, tailleDuPool } from '../src/db/seed.js';
import { battement } from '../src/domain/engine.js';
import {
  creerCommande,
  obtenirCommande,
  provoquerChute,
  lireJournal,
  listerAbonnes,
} from '../src/domain/orders.js';
import { CONFIG } from '../src/config.js';

const quantite = Number(process.argv[2] ?? 2000);
const vitesse = process.argv[3] ?? 'rapide';

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const barre = (progression, largeur = 28) => {
  const pleins = Math.round(progression * largeur);
  return `[${'█'.repeat(pleins)}${'·'.repeat(largeur - pleins)}]`;
};

console.log('\n=== Simulateur de livraison — démonstration hors ligne ===\n');

// 1. Stock
getDb();
if (tailleDuPool() < CONFIG.pool.taille) {
  process.stdout.write('Génération du stock de faux comptes… ');
  remplirLePool();
  console.log('fait.');
}
console.log(`Stock disponible : ${tailleDuPool().toLocaleString('fr-FR')} faux comptes.\n`);

// 2. Commande
const commande = creerCommande({
  target: '@demo',
  quantity: quantite,
  speed: vitesse,
  drop_rate: 0.2,
  auto_refill: true,
});
console.log(`Commande #${commande.order_id} créée : ${quantite} abonnés pour @${commande.target}`);
console.log(`Vitesse « ${vitesse} », taux de chute 20 %, remplacement automatique activé.\n`);

// 3. On fait tourner le moteur nous-mêmes, battement par battement.
let chuteDeclenchee = false;
for (let i = 0; i < 400; i += 1) {
  battement();
  const etat = obtenirCommande(commande.order_id);

  process.stdout.write(
    `\r  ${barre(etat.progress)} ${String(etat.delivered).padStart(6)} / ${etat.quantity}` +
      `  ${etat.status.padEnd(10)} chutes: ${String(etat.dropped).padStart(4)}  `,
  );

  // À mi-parcours, on provoque une chute manuelle pour observer le refill.
  if (!chuteDeclenchee && etat.delivered > etat.quantity * 0.5) {
    chuteDeclenchee = true;
    process.stdout.write('\n');
    const apres = provoquerChute(commande.order_id, { percent: 25 });
    console.log(`  ⚠ Chute simulée : ${apres.dropped_now} abonnés perdus d'un coup.\n`);
  }

  if (etat.status === 'completed' && chuteDeclenchee && etat.remaining === 0) break;
  await pause(CONFIG.moteur.intervalleMs / 5); // on accélère le temps ×5
}

process.stdout.write('\n\n');

// 4. Bilan
const final = obtenirCommande(commande.order_id);
console.log('--- État final -------------------------------------------');
console.table({
  order_id: final.order_id,
  target: final.target,
  quantity: final.quantity,
  delivered: final.delivered,
  remaining: final.remaining,
  dropped: final.dropped,
  refilled: final.refilled,
  status: final.status,
});

console.log('--- Journal ----------------------------------------------');
for (const evenement of lireJournal(final.order_id, 12).reverse()) {
  console.log(`  ${evenement.type.padEnd(10)} ${evenement.message}`);
}

console.log('\n--- Échantillon de faux abonnés --------------------------');
for (const abonne of listerAbonnes(final.order_id, { limite: 6 })) {
  console.log(`  @${abonne.username.padEnd(28)} ${abonne.quality.padEnd(8)} ${abonne.state}`);
}

console.log('\nRappel : tout ceci est fictif et local. Aucun réseau contacté.\n');
closeDb();
