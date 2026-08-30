/**
 * public/js/api.js — Petite couche d'accès à l'API locale, partagée par les
 * deux pages. Aucun framework : `fetch` + `EventSource` suffisent.
 */

/** Appel JSON générique. Lève une Error portant le message renvoyé par l'API. */
async function appeler(url, options = {}) {
  const reponse = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const donnees = await reponse.json().catch(() => ({}));
  if (!reponse.ok) {
    throw new Error(donnees?.error?.message ?? `Erreur ${reponse.status}`);
  }
  return donnees;
}

export const API = {
  config: () => appeler('/api/config'),
  stats: () => appeler('/api/stats'),
  listerCommandes: (limite = 50) => appeler(`/api/orders?limit=${limite}`),
  creerCommande: (charge) => appeler('/api/order', { method: 'POST', body: JSON.stringify(charge) }),
  commande: (id) => appeler(`/api/order/${id}`),
  journal: (id, limite = 40) => appeler(`/api/order/${id}/events?limit=${limite}`),
  abonnes: (id, limite = 40) => appeler(`/api/order/${id}/followers?limit=${limite}`),
  annuler: (id) => appeler(`/api/order/${id}/cancel`, { method: 'POST' }),
  chute: (id, charge = {}) => appeler(`/api/order/${id}/drop`, { method: 'POST', body: JSON.stringify(charge) }),
  refill: (id) => appeler(`/api/order/${id}/refill`, { method: 'POST' }),
};

/**
 * Ouvre le flux temps réel. `EventSource` gère seul la reconnexion.
 * @param {(type: string, donnees: object) => void} surEvenement
 * @param {number|null} idCommande  filtre optionnel sur une commande
 */
export function ecouterLeFlux(surEvenement, idCommande = null) {
  const url = idCommande ? `/api/stream?order=${idCommande}` : '/api/stream';
  const source = new EventSource(url);
  for (const type of ['order:created', 'order:updated', 'order:progress', 'order:completed', 'order:drop', 'order:event']) {
    source.addEventListener(type, (message) => {
      const charge = JSON.parse(message.data);
      surEvenement(charge.type, charge.donnees);
    });
  }
  return source;
}

/* ------------------------------------------------------------------ */
/* Petits utilitaires d'affichage                                      */
/* ------------------------------------------------------------------ */

/** 10000 -> « 10 000 » */
export const nombre = (valeur) => Number(valeur ?? 0).toLocaleString('fr-FR');

const LIBELLES_STATUT = {
  pending: 'En attente',
  processing: 'En cours',
  completed: 'Terminée',
  cancelled: 'Annulée',
};

export const libelleStatut = (statut) => LIBELLES_STATUT[statut] ?? statut;

/** Heure courte d'un horodatage ISO. */
export const heure = (iso) => new Date(iso).toLocaleTimeString('fr-FR');

/** Couleur d'avatar déterministe, dérivée de la graine du faux compte. */
export function couleurAvatar(graine) {
  let empreinte = 0;
  for (const caractere of String(graine)) {
    empreinte = (empreinte * 31 + caractere.charCodeAt(0)) % 360;
  }
  return `hsl(${empreinte}, 62%, 62%)`;
}

/** Échappe le texte injecté dans le HTML (les pseudos sont générés, mais on
 *  ne fait jamais confiance à une chaîne d'entrée). */
export function echapper(texte) {
  return String(texte ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
