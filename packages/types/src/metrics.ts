import type { Timestamp } from './ids.js';

/**
 * Toutes les dimensions du tableau de bord sont des séries temporelles
 * homogènes. Un seul mécanisme d'écriture, un seul de lecture : ajouter
 * « sommeil » ou « nutrition » plus tard ne demandera aucune migration.
 */
export type MetricKey =
  | 'productivity'
  | 'discipline'
  | 'work_hours'
  | 'deep_work_hours'
  | 'sport'
  | 'sleep_hours'
  | 'sleep_quality'
  | 'nutrition'
  | 'mood'
  | 'motivation'
  | 'energy'
  | 'stress'
  | 'focus'
  | 'money_in'
  | 'money_out'
  | 'learning_hours'
  | 'social'
  | (string & {}); // extensible sans casser le typage

/** D'où vient la mesure : ça change la confiance qu'on lui accorde. */
export type MetricSource =
  /** Déclaré explicitement par l'utilisateur (« j'ai dormi 6h »). */
  | 'declared'
  /** Déduit par un agent à partir du discours. */
  | 'inferred'
  /** Mesuré (activité git, fichiers modifiés, temps d'usage). */
  | 'observed'
  /** Importé d'un service tiers. */
  | 'imported';

export interface MetricPoint {
  id: string;
  key: MetricKey;
  at: Timestamp;
  value: number;
  unit?: string;
  source: MetricSource;
  confidence: number;
  meta?: Record<string, unknown>;
}

export type Granularity = 'hour' | 'day' | 'week' | 'month';

export interface MetricSeries {
  key: MetricKey;
  granularity: Granularity;
  points: Array<{ at: Timestamp; value: number; count: number }>;
}

/**
 * Une tendance : la comparaison d'une fenêtre récente à sa précédente.
 * C'est la primitive derrière « tu travailles beaucoup moins cette semaine ».
 */
export interface MetricTrend {
  key: MetricKey;
  current: number;
  previous: number;
  /** Variation relative, -1 → +∞. */
  delta: number;
  direction: 'up' | 'down' | 'flat';
  /** Écart en nombre d'écarts-types — filtre le bruit. */
  zScore: number;
  windowDays: number;
  sampleSize: number;
}

/** Le profil complet affiché sur le tableau de bord. */
export interface DashboardSnapshot {
  at: Timestamp;
  trends: MetricTrend[];
  series: MetricSeries[];
  /** Corrélations détectées entre deux dimensions (« motivé le matin »). */
  correlations: MetricCorrelation[];
  streaks: HabitStreak[];
}

export interface MetricCorrelation {
  a: MetricKey;
  b: MetricKey;
  /** Coefficient de Pearson, -1 → 1. */
  r: number;
  sampleSize: number;
  /** Décalage en jours appliqué à `b` (permet « le sport d'hier »). */
  lagDays: number;
}

export interface HabitStreak {
  habit: string;
  currentStreak: number;
  bestStreak: number;
  lastDoneAt?: Timestamp;
  /** Régularité sur 30 jours, 0-1. */
  consistency: number;
}
