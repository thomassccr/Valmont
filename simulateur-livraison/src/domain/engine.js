/**
 * domain/engine.js — Le moteur de progression (étapes 3, 6 et 8).
 *
 * C'est le « worker » du faux fournisseur. Il bat à intervalle régulier
 * (CONFIG.moteur.intervalleMs) et, à chaque battement :
 *
 *   1. fait passer en `processing` les commandes dont la file d'attente est
 *      écoulée ;
 *   2. livre un paquet d'abonnés aux commandes en cours, à la vitesse du
 *      profil choisi ;
 *   3. marque `completed` celles qui ont atteint leur quantité ;
 *   4. une fois sur six, évalue les chutes naturelles (« drops ») et déclenche
 *      les remplacements si la garantie est active.
 *
 * Aucune connexion réseau n'est faite : « livrer » signifie ici passer une
 * ligne de la table `deliveries` de l'état `queued` à l'état `active`.
 */

import { getDb } from '../db/index.js';
import { CONFIG, STATUTS, ETATS_LIVRAISON } from '../config.js';
import { calculerLotDuBattement } from './speed.js';
import {
  journaliser,
  ligneCommande,
  obtenirCommande,
  provoquerChute,
  recalculerCompteurs,
} from './orders.js';
import { publier } from '../events.js';

let minuteur = null;
let compteurBattements = 0;

const maintenant = () => new Date().toISOString();

// =====================================================================
// Étape 1 — sortie de la file d'attente
// =====================================================================

function demarrerLesCommandesEnAttente(date) {
  const db = getDb();
  const enAttente = db
    .prepare('SELECT order_id FROM orders WHERE status = ? AND start_after <= ?')
    .all(STATUTS.EN_ATTENTE, date);

  for (const { order_id: orderId } of enAttente) {
    db.prepare('UPDATE orders SET status = ?, started_at = ?, updated_at = ? WHERE order_id = ?').run(
      STATUTS.EN_COURS,
      date,
      date,
      orderId,
    );
    journaliser(orderId, 'started', 'Le fournisseur a pris la commande en charge : livraison démarrée.');
    publier('order:updated', obtenirCommande(orderId));
  }
}

// =====================================================================
// Étape 2 — livraison d'un paquet d'abonnés
// =====================================================================

/**
 * Livre au plus `nombre` abonnés réservés pour cette commande.
 * @returns {number} nombre d'abonnés réellement livrés
 */
function livrerUnPaquet(orderId, nombre, date) {
  if (nombre <= 0) return 0;
  return getDb()
    .prepare(
      `UPDATE deliveries SET state = '${ETATS_LIVRAISON.ACTIF}', delivered_at = ?
        WHERE id IN (
          SELECT id FROM deliveries
           WHERE order_id = ? AND state = '${ETATS_LIVRAISON.RESERVE}'
           ORDER BY id
           LIMIT ?
        )`,
    )
    .run(date, orderId, nombre).changes;
}

function traiterUneCommandeEnCours(ligne, date) {
  // Un refill vient d'être programmé : on attend que le délai s'écoule.
  if (ligne.resume_after && ligne.resume_after > date) return;

  const restant = ligne.quantity - ligne.delivered;
  if (restant <= 0) {
    terminerLaCommande(ligne.order_id, date);
    return;
  }

  const depuis = Date.parse(ligne.started_at ?? ligne.created_at);
  const lot = Math.min(restant, calculerLotDuBattement(ligne.speed, Date.now() - depuis));
  if (lot <= 0) return; // pause du fournisseur : rien à faire ce battement

  const livres = livrerUnPaquet(ligne.order_id, lot, date);

  if (livres === 0) {
    // Plus aucun compte réservé disponible : le stock du fournisseur est vide.
    journaliser(
      ligne.order_id,
      'progress',
      `Stock épuisé : impossible de livrer les ${restant} abonnés restants.`,
    );
    terminerLaCommande(ligne.order_id, date, { partielle: true });
    return;
  }

  recalculerCompteurs(ligne.order_id);
  const apres = ligneCommande(ligne.order_id);
  publier('order:progress', obtenirCommande(ligne.order_id));

  if (apres.delivered >= apres.quantity) {
    terminerLaCommande(ligne.order_id, date);
  }
}

function terminerLaCommande(orderId, date, { partielle = false } = {}) {
  const db = getDb();
  db.prepare(
    'UPDATE orders SET status = ?, completed_at = ?, resume_after = NULL, updated_at = ? WHERE order_id = ?',
  ).run(STATUTS.TERMINEE, date, date, orderId);

  const ligne = ligneCommande(orderId);
  journaliser(
    orderId,
    'completed',
    partielle
      ? `Commande clôturée partiellement : ${ligne.delivered} / ${ligne.quantity}.`
      : `Commande terminée : ${ligne.delivered} / ${ligne.quantity} abonnés livrés.`,
  );
  publier('order:completed', obtenirCommande(orderId));
}

// =====================================================================
// Étape 4 — chutes naturelles et remplacements
// =====================================================================

function evaluerLesChutes(date) {
  const db = getDb();
  const candidates = db
    .prepare(
      `SELECT * FROM orders
        WHERE drop_rate > 0 AND delivered > 0
          AND status IN (?, ?)`,
    )
    .all(STATUTS.EN_COURS, STATUTS.TERMINEE);

  for (const ligne of candidates) {
    // Une commande en plein refill ne rechute pas immédiatement.
    if (ligne.resume_after && ligne.resume_after > date) continue;

    const probabilite = ligne.drop_rate * CONFIG.chute.coefficientProbabilite;
    if (Math.random() >= probabilite) continue;

    // `provoquerChute` déclenche lui-même le refill si la garantie est active.
    provoquerChute(ligne.order_id, { auto: true });
  }
}

// =====================================================================
// Boucle principale
// =====================================================================

/** Un battement du moteur. Exporté pour pouvoir être testé isolément. */
export function battement() {
  const date = maintenant();
  compteurBattements += 1;

  demarrerLesCommandesEnAttente(date);

  const enCours = getDb().prepare('SELECT * FROM orders WHERE status = ?').all(STATUTS.EN_COURS);
  for (const ligne of enCours) traiterUneCommandeEnCours(ligne, date);

  if (compteurBattements % CONFIG.chute.battementsParEvaluation === 0) {
    evaluerLesChutes(date);
  }
}

/** Démarre le moteur (appelé au lancement du serveur). */
export function demarrerMoteur() {
  if (minuteur) return;
  minuteur = setInterval(() => {
    try {
      battement();
    } catch (erreur) {
      // Le moteur ne doit jamais tuer le serveur : on log et on continue.
      console.error('[moteur] erreur pendant un battement :', erreur.message);
    }
  }, CONFIG.moteur.intervalleMs);
  // Le moteur ne doit pas empêcher Node de s'arrêter proprement.
  minuteur.unref?.();
}

/** Arrête le moteur. */
export function arreterMoteur() {
  if (minuteur) {
    clearInterval(minuteur);
    minuteur = null;
  }
}
