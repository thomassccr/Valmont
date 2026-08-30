/**
 * domain/usernames.js — Générateur de pseudos fictifs.
 *
 * Aucun de ces pseudos ne correspond à un compte réel : ce sont des
 * assemblages aléatoires de morceaux de mots. C'est exactement la façon dont
 * les fermes à bots nomment leurs comptes en masse (préfixe + mot + suffixe
 * + chiffres), ce qui explique pourquoi ces pseudos « se ressemblent tous » et
 * pourquoi ils sont si faciles à repérer.
 */

import { CONFIG } from '../config.js';

const PREFIXES = [
  'the', 'its', 'im', 'real', 'official', 'mr', 'ms', 'lil', 'big', 'yo',
  'just', 'only', 'daily', 'go', 'be', 'my', 'we', 'x', 'itz', 'not',
];

const RACINES = [
  'luna', 'nova', 'zephyr', 'orbit', 'pixel', 'vibe', 'echo', 'atlas', 'ember',
  'coral', 'stellar', 'onyx', 'quartz', 'mango', 'velvet', 'cosmo', 'aurora',
  'drift', 'harbor', 'juno', 'kite', 'lyric', 'meadow', 'nimbus', 'opal',
  'prism', 'quill', 'ripple', 'saffron', 'tide', 'umber', 'vertex', 'willow',
  'yarrow', 'zenith', 'brume', 'cedar', 'delta', 'flare', 'grove', 'halo',
  'indigo', 'jade', 'krypton', 'lotus', 'mirage', 'north', 'ocean', 'plume',
];

const SUFFIXES = [
  'ly', 'ish', 'zz', 'xo', 'hq', 'co', 'io', 'ster', 'wave', 'core', 'lab',
  'club', 'daily', 'world', 'life', 'gram', 'shots', 'vibes', 'story', '',
];

const SEPARATEURS = ['', '', '', '_', '.'];

const PRENOMS = [
  'Alex', 'Sam', 'Nora', 'Milo', 'Iris', 'Théo', 'Lina', 'Noah', 'Maya', 'Elio',
  'Zoé', 'Kai', 'Ava', 'Léo', 'Mia', 'Ruben', 'Sofia', 'Jonas', 'Emma', 'Ilan',
];

const NOMS = [
  'Marchand', 'Duval', 'Reyes', 'Kowalski', 'Ferrari', 'Okafor', 'Lindqvist',
  'Costa', 'Novak', 'Haddad', 'Weber', 'Silva', 'Nakamura', 'Blanc', 'Moreau',
];

/** Entier aléatoire dans [min, max] inclus. */
export function entierAleatoire(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Élément aléatoire d'un tableau. */
export function elementAleatoire(tableau) {
  return tableau[Math.floor(Math.random() * tableau.length)];
}

/**
 * Tire une qualité de compte en respectant les poids définis dans la config.
 * (55 % de bots, 32 % d'inactifs, 13 % d'anciens par défaut.)
 */
export function qualiteAleatoire() {
  const total = CONFIG.pool.qualites.reduce((somme, q) => somme + q.poids, 0);
  let tirage = Math.random() * total;
  for (const qualite of CONFIG.pool.qualites) {
    tirage -= qualite.poids;
    if (tirage <= 0) return qualite.id;
  }
  return CONFIG.pool.qualites.at(-1).id;
}

/** Fabrique un pseudo fictif du type `the_luna_shots92`. */
export function genererUsername() {
  const morceaux = [];
  if (Math.random() < 0.45) morceaux.push(elementAleatoire(PREFIXES));
  morceaux.push(elementAleatoire(RACINES));
  if (Math.random() < 0.6) morceaux.push(elementAleatoire(RACINES));
  const suffixe = elementAleatoire(SUFFIXES);
  if (suffixe) morceaux.push(suffixe);

  const separateur = elementAleatoire(SEPARATEURS);
  let pseudo = morceaux.filter(Boolean).join(separateur);

  // Les fermes à bots numérotent massivement leurs comptes : c'est le principal
  // marqueur visuel d'un faux abonné.
  if (Math.random() < 0.8) pseudo += entierAleatoire(1, 9999);

  return pseudo.toLowerCase().slice(0, 30);
}

/** Nom affiché fictif, parfois vide (beaucoup de bots n'en ont pas). */
export function genererNomAffiche() {
  if (Math.random() < 0.25) return '';
  const prenom = elementAleatoire(PRENOMS);
  if (Math.random() < 0.5) return prenom;
  return `${prenom} ${elementAleatoire(NOMS)}`;
}

/**
 * Fabrique un faux utilisateur complet.
 * `avatarSeed` sert uniquement à générer un avatar coloré déterministe côté
 * interface : aucune image réelle n'est téléchargée.
 */
export function genererFauxUtilisateur() {
  return {
    username: genererUsername(),
    display_name: genererNomAffiche(),
    avatar_seed: Math.random().toString(36).slice(2, 10),
    quality: qualiteAleatoire(),
  };
}

/** Normalise un pseudo cible saisi par l'utilisateur (`@Test ` -> `test`). */
export function normaliserCible(valeur) {
  return String(valeur ?? '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
}

/** Un pseudo cible valide : 1 à 30 caractères, lettres/chiffres/._ */
export function cibleValide(cible) {
  return /^[a-z0-9._]{1,30}$/.test(cible);
}
