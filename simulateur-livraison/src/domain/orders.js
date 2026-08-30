/**
 * domain/orders.js — Toute la logique métier des commandes.
 *
 * Ce module est le « cerveau » du faux fournisseur. Il ne connaît ni HTTP ni
 * l'interface : il expose des fonctions qui créent, lisent et modifient des
 * commandes dans la base locale. Le moteur (engine.js) et l'API (api/routes.js)
 * s'appuient dessus.
 *
 * Cycle de vie d'une commande :
 *
 *   pending ──(file d'attente écoulée)──> processing ──(quantité atteinte)──> completed
 *      │                                      │                                   │
 *      └──────────── cancelled ───────────────┘                     (drop) ───────┘
 *                                                                       │
 *                                            completed <──(refill)── processing
 */

import { getDb, transaction } from '../db/index.js';
import { CONFIG, STATUTS, ETATS_LIVRAISON } from '../config.js';
import { normaliserCible, cibleValide, entierAleatoire } from './usernames.js';
import { vitesseConnue, estimerDureeSecondes } from './speed.js';
import { publier } from '../events.js';

/** Erreur métier : le contrôleur HTTP la traduit en réponse 4xx. */
export class ErreurMetier extends Error {
  constructor(message, statut = 400, code = 'invalid_request') {
    super(message);
    this.statut = statut;
    this.code = code;
  }
}

const maintenant = () => new Date().toISOString();

/**
 * Expression SQL qui pondère la fragilité d'un faux compte selon sa qualité.
 * Construite depuis la config pour rester la seule source de vérité.
 * Utilisée pour choisir *quels* comptes chutent : les bots récents partent en
 * premier, les comptes anciens tiennent plus longtemps.
 */
const EXPRESSION_FRAGILITE = `CASE u.quality ${CONFIG.pool.qualites
  .map((q) => `WHEN '${q.id}' THEN ${q.fragilite}`)
  .join(' ')} ELSE 1 END`;

// =====================================================================
// Journal
// =====================================================================

/** Ajoute une ligne au journal d'une commande et la diffuse en temps réel. */
export function journaliser(orderId, type, message) {
  const db = getDb();
  db.prepare(
    'INSERT INTO order_events (order_id, type, message, created_at) VALUES (?, ?, ?, ?)',
  ).run(orderId, type, message, maintenant());

  // On borne le journal pour ne pas laisser gonfler la base indéfiniment.
  db.prepare(
    `DELETE FROM order_events WHERE order_id = ? AND id NOT IN (
       SELECT id FROM order_events WHERE order_id = ? ORDER BY id DESC LIMIT ?
     )`,
  ).run(orderId, orderId, CONFIG.journal.maxParCommande);

  publier('order:event', { order_id: orderId, type, message, at: maintenant() });
}

/** Renvoie le journal d'une commande, du plus récent au plus ancien. */
export function lireJournal(orderId, limite = 50) {
  return getDb()
    .prepare('SELECT type, message, created_at FROM order_events WHERE order_id = ? ORDER BY id DESC LIMIT ?')
    .all(orderId, limite);
}

// =====================================================================
// Lecture
// =====================================================================

/**
 * Met une ligne SQL au format renvoyé par l'API.
 * C'est ici que sont calculés `remaining` et le pourcentage de progression.
 */
export function serialiser(ligne) {
  if (!ligne) return null;
  const restant = Math.max(0, ligne.quantity - ligne.delivered);
  return {
    order_id: ligne.order_id,
    target: ligne.target,
    quantity: ligne.quantity,
    delivered: ligne.delivered,
    remaining: restant,
    dropped: ligne.dropped,
    refilled: ligne.refilled,
    status: ligne.status,
    speed: ligne.speed,
    drop_rate: ligne.drop_rate,
    auto_refill: Boolean(ligne.auto_refill),
    progress: ligne.quantity > 0 ? Math.min(1, ligne.delivered / ligne.quantity) : 0,
    created_at: ligne.created_at,
    started_at: ligne.started_at,
    completed_at: ligne.completed_at,
    cancelled_at: ligne.cancelled_at,
    updated_at: ligne.updated_at,
  };
}

/** Ligne brute d'une commande (usage interne au moteur). */
export function ligneCommande(orderId) {
  return getDb().prepare('SELECT * FROM orders WHERE order_id = ?').get(orderId) ?? null;
}

/** Une commande au format API, ou `null` si elle n'existe pas. */
export function obtenirCommande(orderId) {
  return serialiser(ligneCommande(orderId));
}

/** Liste des commandes, les plus récentes d'abord (alimente le dashboard). */
export function listerCommandes({ statut = null, limite = 50 } = {}) {
  const db = getDb();
  const lignes = statut
    ? db.prepare('SELECT * FROM orders WHERE status = ? ORDER BY order_id DESC LIMIT ?').all(statut, limite)
    : db.prepare('SELECT * FROM orders ORDER BY order_id DESC LIMIT ?').all(limite);
  return lignes.map(serialiser);
}

/** Les faux abonnés rattachés à une commande (pour inspecter le résultat). */
export function listerAbonnes(orderId, { limite = 50, etat = null } = {}) {
  const db = getDb();
  const filtreEtat = etat ? 'AND d.state = ?' : "AND d.state IN ('active','dropped')";
  const parametres = etat ? [orderId, etat, limite] : [orderId, limite];
  return db
    .prepare(
      `SELECT u.username, u.display_name, u.avatar_seed, u.quality,
              d.state, d.is_refill, d.delivered_at, d.dropped_at
         FROM deliveries d
         JOIN fake_users u ON u.id = d.fake_user_id
        WHERE d.order_id = ? ${filtreEtat}
        ORDER BY d.id DESC
        LIMIT ?`,
    )
    .all(...parametres)
    .map((ligne) => ({ ...ligne, is_refill: Boolean(ligne.is_refill) }));
}

/** Compteurs globaux affichés en haut du dashboard. */
export function statistiques() {
  const db = getDb();
  const parStatut = db.prepare('SELECT status, COUNT(*) AS total FROM orders GROUP BY status').all();
  const totaux = db
    .prepare('SELECT COALESCE(SUM(quantity),0) AS commande, COALESCE(SUM(delivered),0) AS livre, COALESCE(SUM(dropped),0) AS chute, COALESCE(SUM(refilled),0) AS remplace FROM orders')
    .get();
  const pool = db.prepare('SELECT COUNT(*) AS total FROM fake_users').get().total;

  const compteurs = { pending: 0, processing: 0, completed: 0, cancelled: 0 };
  for (const ligne of parStatut) compteurs[ligne.status] = ligne.total;

  return {
    commandes: compteurs,
    total_commandes: Object.values(compteurs).reduce((a, b) => a + b, 0),
    abonnes_commandes: totaux.commande,
    abonnes_livres: totaux.livre,
    abonnes_chutes: totaux.chute,
    abonnes_remplaces: totaux.remplace,
    taille_du_pool: pool,
  };
}

// =====================================================================
// Écriture
// =====================================================================

/** Recalcule les compteurs dénormalisés d'une commande depuis `deliveries`. */
export function recalculerCompteurs(orderId) {
  getDb()
    .prepare(
      `UPDATE orders SET
         delivered = (SELECT COUNT(*) FROM deliveries WHERE order_id = ? AND state = 'active'),
         dropped   = (SELECT COUNT(*) FROM deliveries WHERE order_id = ? AND state = 'dropped'),
         refilled  = (SELECT COUNT(*) FROM deliveries WHERE order_id = ? AND state = 'active' AND is_refill = 1),
         updated_at = ?
       WHERE order_id = ?`,
    )
    .run(orderId, orderId, orderId, maintenant(), orderId);
}

/**
 * Réserve des faux comptes du stock pour une commande.
 *
 * C'est l'étape invisible mais essentielle : avant de « livrer », le
 * fournisseur pioche dans son stock des comptes encore jamais utilisés pour
 * cette cible. Les lignes créées sont à l'état `queued` ; le moteur les fera
 * passer à `active` au fil du temps.
 *
 * @returns {number} nombre de comptes effectivement réservés
 */
export function reserverComptes(orderId, nombre, { refill = false } = {}) {
  if (nombre <= 0) return 0;
  const resultat = getDb()
    .prepare(
      `INSERT OR IGNORE INTO deliveries (order_id, fake_user_id, state, is_refill)
       SELECT ?, u.id, '${ETATS_LIVRAISON.RESERVE}', ?
         FROM fake_users u
        WHERE u.id NOT IN (SELECT fake_user_id FROM deliveries WHERE order_id = ?)
        ORDER BY RANDOM()
        LIMIT ?`,
    )
    .run(orderId, refill ? 1 : 0, orderId, nombre);
  return resultat.changes;
}

/**
 * Crée une commande (étape 2 du système).
 *
 * @param {object} entree
 * @param {string} entree.target       pseudo ciblé (fictif)
 * @param {number} entree.quantity     nombre d'abonnés demandés
 * @param {string} [entree.speed]      profil de vitesse
 * @param {number} [entree.drop_rate]  propension à la chute, 0 -> 0.6
 * @param {boolean} [entree.auto_refill] garantie de remplacement automatique
 */
export function creerCommande(entree = {}) {
  const cible = normaliserCible(entree.target);
  if (!cibleValide(cible)) {
    throw new ErreurMetier(
      'Pseudo cible invalide : 1 à 30 caractères parmi a-z, 0-9, « . » et « _ ».',
      400,
      'invalid_target',
    );
  }

  const quantite = Number(entree.quantity);
  if (!Number.isInteger(quantite) || quantite < CONFIG.commande.quantiteMin || quantite > CONFIG.commande.quantiteMax) {
    throw new ErreurMetier(
      `Quantité invalide : un entier entre ${CONFIG.commande.quantiteMin} et ${CONFIG.commande.quantiteMax}.`,
      400,
      'invalid_quantity',
    );
  }

  const vitesse = entree.speed ?? CONFIG.vitesseParDefaut;
  if (!vitesseConnue(vitesse)) {
    throw new ErreurMetier(`Profil de vitesse inconnu : « ${vitesse} ».`, 400, 'invalid_speed');
  }

  const tauxChute = Math.min(CONFIG.commande.tauxChuteMax, Math.max(0, Number(entree.drop_rate ?? 0)));
  if (Number.isNaN(tauxChute)) {
    throw new ErreurMetier('Taux de chute invalide.', 400, 'invalid_drop_rate');
  }

  const db = getDb();
  const dernier = db.prepare('SELECT MAX(order_id) AS max FROM orders').get().max;
  const orderId = dernier ? dernier + 1 : CONFIG.commande.premierId;

  const creeLe = maintenant();
  const attente = entierAleatoire(CONFIG.commande.attenteMs.min, CONFIG.commande.attenteMs.max);
  const demarrageApres = new Date(Date.now() + attente).toISOString();

  const reserves = transaction(() => {
    db.prepare(
      `INSERT INTO orders (order_id, target, quantity, status, speed, drop_rate, auto_refill,
                           created_at, start_after, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      orderId,
      cible,
      quantite,
      STATUTS.EN_ATTENTE,
      vitesse,
      tauxChute,
      entree.auto_refill ? 1 : 0,
      creeLe,
      demarrageApres,
      creeLe,
    );
    // On réserve immédiatement le stock nécessaire : si le pool est trop petit,
    // on le saura tout de suite (comme un vrai panel en rupture de stock).
    return reserverComptes(orderId, quantite);
  });

  if (reserves < quantite) {
    journaliser(
      orderId,
      'created',
      `Stock insuffisant : seuls ${reserves} faux comptes disponibles sur ${quantite} demandés.`,
    );
  }

  journaliser(
    orderId,
    'created',
    `Commande #${orderId} enregistrée : ${quantite} abonnés pour @${cible} (vitesse ${vitesse}).`,
  );
  journaliser(orderId, 'queued', `En file d'attente chez le fournisseur (~${Math.round(attente / 1000)}s).`);

  const commande = obtenirCommande(orderId);
  publier('order:created', commande);
  return { ...commande, estimation_secondes: estimerDureeSecondes(vitesse, quantite) };
}

/** Annule une commande : la livraison s'arrête, l'acquis reste acquis. */
export function annulerCommande(orderId) {
  const ligne = ligneCommande(orderId);
  if (!ligne) throw new ErreurMetier(`Commande #${orderId} introuvable.`, 404, 'not_found');
  if (ligne.status === STATUTS.ANNULEE) return serialiser(ligne);
  if (ligne.status === STATUTS.TERMINEE) {
    throw new ErreurMetier('Une commande terminée ne peut plus être annulée.', 409, 'already_completed');
  }

  const date = maintenant();
  transaction((db) => {
    db.prepare('UPDATE orders SET status = ?, cancelled_at = ?, updated_at = ? WHERE order_id = ?').run(
      STATUTS.ANNULEE,
      date,
      date,
      orderId,
    );
    // Le stock réservé mais non livré retourne au pool : il redevient
    // disponible pour d'autres commandes.
    db.prepare("DELETE FROM deliveries WHERE order_id = ? AND state = 'queued'").run(orderId);
  });

  recalculerCompteurs(orderId);
  journaliser(orderId, 'cancelled', `Commande annulée après ${ligne.delivered} abonnés livrés.`);

  const commande = obtenirCommande(orderId);
  publier('order:updated', commande);
  return commande;
}

/**
 * Provoque une chute (« drop ») — étape 8 du cahier des charges.
 *
 * Des comptes déjà livrés passent de `active` à `dropped`. Le compteur
 * `delivered` baisse donc, et `remaining` remonte : c'est exactement ce qui
 * déclenche, chez un vrai panel, la procédure de remplacement (refill).
 *
 * @param {number} orderId
 * @param {object} options
 * @param {number} [options.count]    nombre exact d'abonnés à faire chuter
 * @param {number} [options.percent]  pourcentage des abonnés actifs (0 -> 100)
 * @param {boolean} [options.auto]    déclenché par le moteur (et non manuellement)
 */
export function provoquerChute(orderId, { count, percent, auto = false } = {}) {
  const ligne = ligneCommande(orderId);
  if (!ligne) throw new ErreurMetier(`Commande #${orderId} introuvable.`, 404, 'not_found');
  if (ligne.delivered <= 0) {
    throw new ErreurMetier('Aucun abonné livré : rien ne peut chuter.', 409, 'nothing_to_drop');
  }

  let nombre;
  if (Number.isFinite(count) && count > 0) {
    nombre = Math.floor(count);
  } else if (Number.isFinite(percent) && percent > 0) {
    nombre = Math.ceil((ligne.delivered * Math.min(100, percent)) / 100);
  } else {
    // Par défaut : un lot « réaliste » (1 à 6 % du livré).
    const fraction = CONFIG.chute.lotMin + Math.random() * (CONFIG.chute.lotMax - CONFIG.chute.lotMin);
    nombre = Math.max(1, Math.round(ligne.delivered * fraction));
  }
  nombre = Math.min(nombre, ligne.delivered);

  const date = maintenant();
  const touchees = getDb()
    .prepare(
      `UPDATE deliveries SET state = '${ETATS_LIVRAISON.CHUTE}', dropped_at = ?
        WHERE id IN (
          SELECT d.id FROM deliveries d
            JOIN fake_users u ON u.id = d.fake_user_id
           WHERE d.order_id = ? AND d.state = '${ETATS_LIVRAISON.ACTIF}'
           ORDER BY ABS(RANDOM()) / (${EXPRESSION_FRAGILITE})
           LIMIT ?
        )`,
    )
    .run(date, orderId, nombre).changes;

  recalculerCompteurs(orderId);

  const apres = ligneCommande(orderId);
  journaliser(
    orderId,
    'drop',
    `${auto ? 'Chute naturelle' : 'Chute simulée manuellement'} : ${touchees} abonnés perdus — il reste ${apres.delivered} / ${apres.quantity} abonnés actifs.`,
  );

  // Garantie de remplacement : la commande repasse en `processing` et le
  // moteur relivrera la différence après un court délai.
  if (apres.auto_refill && apres.delivered < apres.quantity && apres.status !== STATUTS.ANNULEE) {
    programmerRefill(orderId);
  }

  const commande = obtenirCommande(orderId);
  publier('order:drop', { ...commande, dropped_now: touchees });
  return { ...commande, dropped_now: touchees };
}

/**
 * Programme un remplacement : réserve de nouveaux comptes et remet la commande
 * en cours après un court délai (le temps que le fournisseur réagisse).
 */
export function programmerRefill(orderId) {
  const ligne = ligneCommande(orderId);
  if (!ligne) throw new ErreurMetier(`Commande #${orderId} introuvable.`, 404, 'not_found');
  if (ligne.status === STATUTS.ANNULEE) {
    throw new ErreurMetier('Commande annulée : aucun remplacement possible.', 409, 'cancelled');
  }

  const manquants = ligne.quantity - ligne.delivered;
  if (manquants <= 0) {
    throw new ErreurMetier('Commande complète : aucun remplacement nécessaire.', 409, 'nothing_to_refill');
  }

  // Combien de comptes sont déjà réservés et non encore livrés ?
  const dejaReserves = getDb()
    .prepare("SELECT COUNT(*) AS total FROM deliveries WHERE order_id = ? AND state = 'queued'")
    .get(orderId).total;

  const aReserver = manquants - dejaReserves;
  const reserves = aReserver > 0 ? reserverComptes(orderId, aReserver, { refill: true }) : 0;

  const delai = entierAleatoire(CONFIG.chute.delaiRefillMs.min, CONFIG.chute.delaiRefillMs.max);
  const date = maintenant();
  getDb()
    .prepare('UPDATE orders SET status = ?, resume_after = ?, completed_at = NULL, updated_at = ? WHERE order_id = ?')
    .run(STATUTS.EN_COURS, new Date(Date.now() + delai).toISOString(), date, orderId);

  journaliser(
    orderId,
    'refill',
    `Remplacement lancé : ${reserves} nouveaux comptes réservés — ${manquants} abonnés restent à livrer sur ${ligne.quantity}.`,
  );

  const commande = obtenirCommande(orderId);
  publier('order:updated', commande);
  return commande;
}
