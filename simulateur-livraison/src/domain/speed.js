/**
 * domain/speed.js — Profils de vitesse de livraison.
 *
 * Un panel ne vend pas seulement une quantité, il vend une *vitesse*. Ce module
 * traduit un profil (« rapide », « goutte-à-goutte »…) en un nombre d'abonnés à
 * livrer pendant un battement du moteur, avec trois effets qui rendent la
 * courbe crédible :
 *   1. une part d'aléatoire (le débit n'est jamais constant) ;
 *   2. un démarrage progressif (le fournisseur « chauffe ») ;
 *   3. des pauses aléatoires (rate limit, file saturée).
 */

import { CONFIG } from '../config.js';

/** Liste des profils, prête à être envoyée à l'interface. */
export function listerVitesses() {
  return Object.entries(CONFIG.vitesses).map(([id, profil]) => ({
    id,
    libelle: profil.libelle,
    description: profil.description,
    parSeconde: profil.parSeconde,
    defaut: id === CONFIG.vitesseParDefaut,
  }));
}

/** Vrai si l'identifiant de vitesse existe. */
export function vitesseConnue(id) {
  return Object.hasOwn(CONFIG.vitesses, id);
}

/**
 * Combien d'abonnés livrer pendant ce battement ?
 *
 * @param {string} idVitesse   clé du profil (ex. 'normale')
 * @param {number} ecouleMs    temps écoulé depuis le début de la livraison
 * @returns {number} nombre d'abonnés à livrer (peut valoir 0 : pause)
 */
export function calculerLotDuBattement(idVitesse, ecouleMs) {
  const profil = CONFIG.vitesses[idVitesse] ?? CONFIG.vitesses[CONFIG.vitesseParDefaut];

  // 1. Pause aléatoire : le fournisseur ne livre rien pendant ce battement.
  if (Math.random() < CONFIG.moteur.probabilitePause) return 0;

  // 2. Débit de base tiré dans la fourchette du profil.
  const { min, max } = profil.parSeconde;
  const parSeconde = min + Math.random() * (max - min);

  // 3. Démarrage progressif : au début, on ne délivre qu'une fraction du débit.
  const rampe = Math.min(1, ecouleMs / CONFIG.moteur.demarrageProgressifMs);
  // 0.25 -> 1 : même au premier battement il se passe quelque chose.
  const facteurRampe = 0.25 + 0.75 * rampe;

  const secondesParBattement = CONFIG.moteur.intervalleMs / 1000;
  const lot = parSeconde * secondesParBattement * facteurRampe;

  // Arrondi probabiliste : pour un débit de 2,4/battement on livre 2 ou 3.
  const entier = Math.floor(lot);
  const reste = lot - entier;
  return entier + (Math.random() < reste ? 1 : 0);
}

/** Estimation de durée totale (en secondes) affichée avant de commander. */
export function estimerDureeSecondes(idVitesse, quantite) {
  const profil = CONFIG.vitesses[idVitesse] ?? CONFIG.vitesses[CONFIG.vitesseParDefaut];
  const moyenne = (profil.parSeconde.min + profil.parSeconde.max) / 2;
  // On tient compte des pauses : le débit réel est plus bas que le débit brut.
  const debitReel = moyenne * (1 - CONFIG.moteur.probabilitePause);
  return Math.max(1, Math.round(quantite / debitReel));
}
