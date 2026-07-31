import type { Timestamp } from '@valmont/types';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;

/**
 * Horloge injectable. Toute logique temporelle (décroissance de la mémoire,
 * tendances, temporisation des initiatives) passe par ici : c'est la seule
 * façon de tester « et dans trois semaines ? » sans attendre trois semaines.
 */
export interface Clock {
  now(): Timestamp;
  /** Début du jour local pour un instant donné. */
  startOfDay(at?: Timestamp): Timestamp;
  /** Clé `YYYY-MM-DD` en heure locale — sert d'agrégat journalier. */
  dayKey(at?: Timestamp): string;
  /** Heure locale décimale (13.5 = 13h30), pour les rythmes circadiens. */
  hourOfDay(at?: Timestamp): number;
  /** 0 = dimanche. */
  dayOfWeek(at?: Timestamp): number;
  timezone: string;
}

export function createClock(
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  nowFn: () => number = Date.now,
): Clock {
  return {
    timezone,
    now: nowFn,
    startOfDay(at = nowFn()) {
      const date = new Date(at);
      date.setHours(0, 0, 0, 0);
      return date.getTime();
    },
    dayKey(at = nowFn()) {
      const date = new Date(at);
      const month = `${date.getMonth() + 1}`.padStart(2, '0');
      const day = `${date.getDate()}`.padStart(2, '0');
      return `${date.getFullYear()}-${month}-${day}`;
    },
    hourOfDay(at = nowFn()) {
      const date = new Date(at);
      return date.getHours() + date.getMinutes() / 60;
    },
    dayOfWeek(at = nowFn()) {
      return new Date(at).getDay();
    },
  };
}

/** Horloge contrôlée, pour les tests et les simulations long terme. */
export function createFakeClock(start: Timestamp = Date.now()): Clock & { advance(ms: number): void } {
  let current = start;
  const clock = createClock(undefined, () => current);
  return Object.assign(clock, {
    advance(ms: number) {
      current += ms;
    },
  });
}

/** Formate une durée écoulée en français naturel (« il y a 3 jours »). */
export function timeAgo(at: Timestamp, now: Timestamp = Date.now()): string {
  const diff = Math.max(0, now - at);
  if (diff < MINUTE) return "à l'instant";
  if (diff < HOUR) {
    const minutes = Math.round(diff / MINUTE);
    return `il y a ${minutes} minute${minutes > 1 ? 's' : ''}`;
  }
  if (diff < DAY) {
    const hours = Math.round(diff / HOUR);
    return `il y a ${hours} heure${hours > 1 ? 's' : ''}`;
  }
  const days = Math.round(diff / DAY);
  if (days === 1) return 'hier';
  if (days < 31) return `il y a ${days} jours`;
  const months = Math.round(days / 30);
  if (months < 12) return `il y a ${months} mois`;
  const years = Math.round(days / 365);
  return `il y a ${years} an${years > 1 ? 's' : ''}`;
}
