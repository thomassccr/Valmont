/**
 * Identifiants. On utilise des chaînes triables dans le temps (ULID-like)
 * plutôt que des UUID v4 : l'ordre lexicographique = l'ordre chronologique,
 * ce qui rend les index SQLite et les curseurs de pagination triviaux.
 */

/** Horodatage en millisecondes epoch. Unité canonique du système. */
export type Timestamp = number;

/** Identifiant opaque, triable chronologiquement. */
export type Id = string;

export type MemoryId = Id;
export type EntityId = Id;
export type RelationId = Id;
export type SessionId = Id;
export type MessageId = Id;
export type EventId = Id;
export type ThemeId = Id;
export type InitiativeId = Id;
export type DocumentId = Id;

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

let lastTime = 0;
let lastRandom: number[] = [];

/**
 * Génère un identifiant monotone : deux appels dans la même milliseconde
 * restent strictement ordonnés (on incrémente la partie aléatoire).
 */
export function newId(now: Timestamp = Date.now()): Id {
  let time = now;
  if (time === lastTime) {
    // Même milliseconde : on incrémente le suffixe aléatoire précédent.
    for (let i = lastRandom.length - 1; i >= 0; i--) {
      const v = (lastRandom[i] ?? 0) + 1;
      if (v < 32) {
        lastRandom[i] = v;
        break;
      }
      lastRandom[i] = 0;
    }
  } else {
    if (time < lastTime) time = lastTime; // horloge qui recule : on ne régresse pas
    lastTime = time;
    lastRandom = Array.from({ length: 16 }, () => Math.floor(Math.random() * 32));
  }

  let timePart = '';
  let t = time;
  for (let i = 0; i < 10; i++) {
    timePart = ULID_ALPHABET[t % 32] + timePart;
    t = Math.floor(t / 32);
  }
  const randomPart = lastRandom.map((n) => ULID_ALPHABET[n]).join('');
  return timePart + randomPart;
}

/** Extrait l'horodatage encodé dans un identifiant. */
export function idTimestamp(id: Id): Timestamp {
  let t = 0;
  for (let i = 0; i < 10; i++) {
    t = t * 32 + ULID_ALPHABET.indexOf(id[i] ?? '0');
  }
  return t;
}
