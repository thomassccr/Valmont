/**
 * config.js — Tous les réglages du simulateur au même endroit.
 *
 * Le but pédagogique : un « panel » de livraison d'abonnés n'est rien d'autre
 * qu'une file d'attente + un moteur qui débite un stock de comptes à une
 * certaine vitesse. Tous les paramètres qui rendent la simulation crédible
 * (vitesses, file d'attente, taux de chute) sont regroupés ici pour pouvoir
 * jouer avec sans toucher au reste du code.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const CONFIG = {
  // ---------------------------------------------------------------------
  // Serveur HTTP local
  // ---------------------------------------------------------------------
  serveur: {
    port: Number(process.env.PORT ?? 4300),
    // 127.0.0.1 volontairement : le simulateur n'est JAMAIS exposé au réseau.
    host: process.env.HOST ?? '127.0.0.1',
  },

  chemins: {
    racine,
    public: path.join(racine, 'public'),
    baseDeDonnees: path.join(racine, 'data', 'simulateur.db'),
  },

  // ---------------------------------------------------------------------
  // Base de faux utilisateurs (le « stock » du faux fournisseur)
  // ---------------------------------------------------------------------
  pool: {
    // Nombre de faux comptes générés au premier démarrage.
    taille: Number(process.env.POOL_SIZE ?? 40000),
    // Répartition qualitative du stock. C'est ce qui explique pourquoi
    // certaines commandes « chutent » plus que d'autres : un stock de bots
    // fraîchement générés disparaît beaucoup plus vite qu'un stock de comptes
    // anciens. Les poids sont relatifs.
    qualites: [
      { id: 'bot', libelle: 'Bot récent', poids: 55, fragilite: 1.6 },
      { id: 'inactif', libelle: 'Compte inactif', poids: 32, fragilite: 0.9 },
      { id: 'ancien', libelle: 'Compte ancien', poids: 13, fragilite: 0.35 },
    ],
  },

  // ---------------------------------------------------------------------
  // Commandes
  // ---------------------------------------------------------------------
  commande: {
    // Premier numéro de commande (clin d'œil à l'exemple « Commande #18472 »).
    premierId: 18472,
    quantiteMin: 1,
    quantiteMax: 25000,
    // Temps passé en `pending` : la commande est enregistrée mais le
    // fournisseur ne l'a pas encore prise en charge (file d'attente).
    attenteMs: { min: 1500, max: 6000 },
    tauxChuteMax: 0.6,
  },

  // ---------------------------------------------------------------------
  // Moteur de progression
  // ---------------------------------------------------------------------
  moteur: {
    // Le moteur « bat » à intervalle régulier ; à chaque battement il livre
    // un paquet d'abonnés. C'est l'équivalent du worker d'un vrai panel.
    intervalleMs: 500,
    // Probabilité, à chaque battement, que le fournisseur marque une pause
    // (rate limit, file d'attente saturée...). Rend la courbe non linéaire.
    probabilitePause: 0.12,
    // Les premières secondes sont plus lentes : le temps que le fournisseur
    // « chauffe » et réserve ses comptes.
    demarrageProgressifMs: 4000,
  },

  /**
   * Profils de vitesse. `parSeconde` = fourchette d'abonnés livrés par seconde.
   * Un vrai panel vend exactement ça : la même quantité, plus ou moins vite,
   * à des prix différents.
   */
  vitesses: {
    instantanee: {
      libelle: 'Instantanée',
      description: 'Livraison massive immédiate — typique des stocks de bots.',
      parSeconde: { min: 400, max: 900 },
    },
    rapide: {
      libelle: 'Rapide',
      description: 'Quelques centaines d’abonnés par seconde.',
      parSeconde: { min: 120, max: 260 },
    },
    normale: {
      libelle: 'Normale',
      description: 'Vitesse standard d’un panel grand public.',
      parSeconde: { min: 40, max: 90 },
    },
    lente: {
      libelle: 'Lente',
      description: 'Livraison étalée, censée paraître plus « naturelle ».',
      parSeconde: { min: 10, max: 25 },
    },
    goutte_a_goutte: {
      libelle: 'Goutte-à-goutte',
      description: 'Drip-feed : un filet continu sur une longue durée.',
      parSeconde: { min: 2, max: 6 },
    },
  },
  vitesseParDefaut: 'normale',

  // ---------------------------------------------------------------------
  // Chutes (« drops ») et remplacement (« refill »)
  // ---------------------------------------------------------------------
  chute: {
    // Le moteur n'évalue les chutes qu'un battement sur N (elles sont lentes
    // par nature : un vrai drop s'étale sur des heures ou des jours).
    battementsParEvaluation: 6,
    // Fraction du stock livré qui peut disparaître d'un coup.
    lotMin: 0.01,
    lotMax: 0.06,
    // Probabilité d'une chute à chaque évaluation = tauxChute * ce coefficient.
    // Avec un taux de 0,3 : ~4,5 % de risque toutes les 3 secondes.
    coefficientProbabilite: 0.15,
    // Délai avant qu'un refill automatique ne reparte.
    delaiRefillMs: { min: 2000, max: 6000 },
  },

  // ---------------------------------------------------------------------
  // Divers
  // ---------------------------------------------------------------------
  journal: {
    // Nombre d'événements conservés et renvoyés par commande.
    maxParCommande: 200,
  },
};

/** Liste des statuts possibles d'une commande (machine à états). */
export const STATUTS = {
  EN_ATTENTE: 'pending',
  EN_COURS: 'processing',
  TERMINEE: 'completed',
  ANNULEE: 'cancelled',
};

/** États possibles d'une ligne de livraison (un faux abonné ↔ une commande). */
export const ETATS_LIVRAISON = {
  RESERVE: 'queued', // réservé dans le stock, pas encore « livré »
  ACTIF: 'active', // livré et toujours présent
  CHUTE: 'dropped', // livré puis disparu
};
