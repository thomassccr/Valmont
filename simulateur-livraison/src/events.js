/**
 * events.js — Petit bus d'événements interne.
 *
 * Le moteur de progression publie ici tout ce qu'il fait ; le contrôleur SSE
 * (`/api/stream`) s'y abonne et repousse chaque événement vers les navigateurs
 * connectés. C'est ce qui rend la progression « temps réel » côté interface,
 * sans que le navigateur ait besoin d'interroger le serveur en boucle.
 */

import { EventEmitter } from 'node:events';

const bus = new EventEmitter();
// Le dashboard peut ouvrir plusieurs onglets : on lève la limite par défaut.
bus.setMaxListeners(0);

/**
 * Publie un événement.
 * @param {string} type  ex. 'order:progress'
 * @param {object} donnees charge utile sérialisable en JSON
 */
export function publier(type, donnees) {
  bus.emit('evenement', { type, donnees, at: new Date().toISOString() });
}

/**
 * S'abonne au flux. Renvoie la fonction de désabonnement.
 * @param {(evenement: {type:string, donnees:object, at:string}) => void} ecouteur
 */
export function souscrire(ecouteur) {
  bus.on('evenement', ecouteur);
  return () => bus.off('evenement', ecouteur);
}
