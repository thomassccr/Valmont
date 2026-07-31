/**
 * @valmont/types — le vocabulaire commun de tout le système.
 *
 * Ce paquet ne contient **aucune logique** et **aucune dépendance** : c'est
 * volontaire. Tout module (mémoire, agents, noyau, interface, futurs clients
 * mobiles) parle ce langage. Un type qui change ici est un changement de
 * contrat, et doit être traité comme tel.
 */

export * from './ids.js';
export * from './memory.js';
export * from './entities.js';
export * from './conversation.js';
export * from './metrics.js';
export * from './initiative.js';
export * from './profile.js';
export * from './events.js';
export * from './protocol.js';
