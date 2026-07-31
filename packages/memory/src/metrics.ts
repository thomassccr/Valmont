import { DAY, clamp, mean, pearson, stdDev, type Clock } from '@valmont/kernel';
import {
  newId,
  type DashboardSnapshot,
  type EventBus,
  type Granularity,
  type HabitStreak,
  type MetricCorrelation,
  type MetricKey,
  type MetricPoint,
  type MetricSeries,
  type MetricSource,
  type MetricTrend,
} from '@valmont/types';
import { toJson, type Db } from './db.js';

/**
 * Dimensions suivies par défaut sur le tableau de bord. La liste est ouverte :
 * le stockage est générique, ajouter « sommeil » ou « nutrition » ne demande
 * qu'une écriture, jamais une migration.
 */
export const TRACKED_METRICS: MetricKey[] = [
  'productivity',
  'discipline',
  'work_hours',
  'deep_work_hours',
  'sport',
  'sleep_hours',
  'mood',
  'motivation',
  'energy',
  'stress',
  'focus',
  'learning_hours',
  'money_in',
  'money_out',
];

/** Paires dont la corrélation est plausible et actionnable. */
const CORRELATION_PAIRS: Array<[MetricKey, MetricKey, number]> = [
  ['sport', 'mood', 0],
  ['sport', 'motivation', 1],
  ['sleep_hours', 'energy', 0],
  ['sleep_hours', 'productivity', 0],
  ['mood', 'productivity', 0],
  ['motivation', 'work_hours', 0],
  ['stress', 'sleep_hours', 1],
  ['deep_work_hours', 'mood', 1],
];

export class MetricStore {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly bus: EventBus,
  ) {}

  record(input: {
    key: MetricKey;
    value: number;
    at?: number;
    unit?: string;
    source: MetricSource;
    confidence?: number;
    meta?: Record<string, unknown>;
  }): MetricPoint {
    const at = input.at ?? this.clock.now();
    const point: MetricPoint = {
      id: newId(at),
      key: input.key,
      at,
      value: input.value,
      ...(input.unit ? { unit: input.unit } : {}),
      source: input.source,
      confidence: input.confidence ?? (input.source === 'declared' ? 0.95 : 0.6),
      ...(input.meta ? { meta: input.meta } : {}),
    };

    this.db
      .prepare(
        `INSERT INTO metrics (id, key, at, day, value, unit, source, confidence, meta)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        point.id,
        point.key,
        point.at,
        this.clock.dayKey(at),
        point.value,
        point.unit ?? null,
        point.source,
        point.confidence,
        point.meta ? toJson(point.meta) : null,
      );

    this.bus.emit({
      kind: 'metric.recorded',
      actor: 'memory',
      payload: { key: point.key, value: point.value, source: point.source },
    });
    return point;
  }

  /** Agrégat par jour/semaine/mois. Moyenne pondérée par la confiance. */
  series(key: MetricKey, days: number, granularity: Granularity = 'day'): MetricSeries {
    const since = this.clock.now() - days * DAY;
    const bucket =
      granularity === 'month'
        ? `substr(day, 1, 7)`
        : granularity === 'week'
          ? `strftime('%Y-W%W', at / 1000, 'unixepoch', 'localtime')`
          : `day`;

    const rows = this.db
      .prepare<[string, number], { bucket: string; at: number; value: number; count: number }>(
        `SELECT ${bucket} AS bucket, MIN(at) AS at,
                SUM(value * confidence) / SUM(confidence) AS value,
                COUNT(*) AS count
         FROM metrics WHERE key = ? AND at >= ?
         GROUP BY bucket ORDER BY at ASC`,
      )
      .all(key, since);

    return {
      key,
      granularity,
      points: rows.map((row) => ({ at: row.at, value: row.value, count: row.count })),
    };
  }

  /**
   * Tendance : fenêtre courante contre fenêtre précédente de même durée.
   *
   * Le `zScore` est ce qui distingue « il a un peu moins travaillé » d'un vrai
   * décrochage. Sans lui, Valmont signalerait du bruit toutes les semaines et
   * on cesserait de l'écouter.
   */
  trend(key: MetricKey, windowDays = 7): MetricTrend {
    const now = this.clock.now();
    const currentSince = now - windowDays * DAY;
    const previousSince = now - 2 * windowDays * DAY;

    const current = this.valuesBetween(key, currentSince, now);
    const previous = this.valuesBetween(key, previousSince, currentSince);
    // Référence longue : 90 jours donnent l'amplitude normale de la personne.
    const baseline = this.valuesBetween(key, now - 90 * DAY, now);

    const currentMean = mean(current);
    const previousMean = mean(previous);
    const spread = stdDev(baseline);

    const delta = previousMean === 0 ? (currentMean === 0 ? 0 : 1) : (currentMean - previousMean) / Math.abs(previousMean);
    const zScore = spread === 0 ? 0 : (currentMean - mean(baseline)) / spread;

    return {
      key,
      current: currentMean,
      previous: previousMean,
      delta,
      direction: Math.abs(delta) < 0.12 ? 'flat' : delta > 0 ? 'up' : 'down',
      zScore,
      windowDays,
      sampleSize: current.length,
    };
  }

  private valuesBetween(key: MetricKey, from: number, to: number): number[] {
    return this.db
      .prepare<[string, number, number], { value: number }>(
        'SELECT value FROM metrics WHERE key = ? AND at >= ? AND at < ? ORDER BY at ASC',
      )
      .all(key, from, to)
      .map((row) => row.value);
  }

  /** Valeurs moyennes par jour — nécessaire pour aligner deux séries. */
  private dailyMap(key: MetricKey, days: number): Map<string, number> {
    const since = this.clock.now() - days * DAY;
    const out = new Map<string, number>();
    for (const row of this.db
      .prepare<[string, number], { day: string; value: number }>(
        `SELECT day, SUM(value * confidence) / SUM(confidence) AS value
         FROM metrics WHERE key = ? AND at >= ? GROUP BY day`,
      )
      .all(key, since)) {
      out.set(row.day, row.value);
    }
    return out;
  }

  /**
   * Corrélations entre dimensions, avec décalage optionnel.
   *
   * C'est la mécanique derrière « tu sembles plus motivé les jours où tu as
   * fait du sport la veille ». Le décalage compte : l'effet du sport se lit
   * souvent le lendemain, pas le jour même.
   *
   * Volontairement conservateur — 14 jours communs minimum et |r| ≥ 0,45 —
   * parce qu'une fausse corrélation présentée avec assurance détruit la
   * confiance bien plus vite qu'un silence.
   */
  correlations(days = 90): MetricCorrelation[] {
    const out: MetricCorrelation[] = [];

    for (const [a, b, lagDays] of CORRELATION_PAIRS) {
      const mapA = this.dailyMap(a, days);
      const mapB = this.dailyMap(b, days);
      if (mapA.size < 14 || mapB.size < 14) continue;

      const xs: number[] = [];
      const ys: number[] = [];
      for (const [day, valueA] of mapA) {
        const target = lagDays === 0 ? day : shiftDay(day, lagDays);
        const valueB = mapB.get(target);
        if (valueB === undefined) continue;
        xs.push(valueA);
        ys.push(valueB);
      }

      if (xs.length < 14) continue;
      const r = pearson(xs, ys);
      if (Math.abs(r) < 0.45) continue;

      out.push({ a, b, r, sampleSize: xs.length, lagDays });
    }

    return out.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
  }

  /**
   * Séries de jours consécutifs. Une habitude se mesure à sa régularité, pas
   * à son intensité — d'où `consistency` en plus de la série en cours.
   */
  streak(key: MetricKey, threshold = 0.5, days = 90): HabitStreak {
    const daily = this.dailyMap(key, days);
    const today = this.clock.startOfDay();
    const hit = (offset: number): boolean =>
      (daily.get(this.clock.dayKey(today - offset * DAY)) ?? 0) >= threshold;

    // Meilleure série et dernière occurrence, du plus ancien au plus récent.
    let best = 0;
    let running = 0;
    let lastDoneAt: number | undefined;
    for (let offset = days - 1; offset >= 0; offset--) {
      if (hit(offset)) {
        running++;
        best = Math.max(best, running);
        lastDoneAt = today - offset * DAY;
      } else {
        running = 0;
      }
    }

    // Série en cours : on remonte depuis aujourd'hui jusqu'au premier trou.
    // Tolérance d'un jour : une série n'est pas rompue avant que la journée
    // en cours soit finie.
    let current = 0;
    for (let offset = hit(0) ? 0 : 1; offset < days; offset++) {
      if (!hit(offset)) break;
      current++;
    }

    const window = Math.min(days, 30);
    let recentDone = 0;
    for (let offset = 0; offset < window; offset++) {
      if (hit(offset)) recentDone++;
    }

    return {
      habit: key,
      currentStreak: current,
      bestStreak: best,
      ...(lastDoneAt ? { lastDoneAt } : {}),
      consistency: clamp(recentDone / window),
    };
  }

  snapshot(days = 90): DashboardSnapshot {
    const keys = this.activeKeys();
    return {
      at: this.clock.now(),
      trends: keys.map((key) => this.trend(key)),
      series: keys.map((key) => this.series(key, days)),
      correlations: this.correlations(days),
      streaks: ['sport', 'deep_work_hours', 'learning_hours']
        .filter((key) => keys.includes(key))
        .map((key) => this.streak(key)),
    };
  }

  /** Seules les dimensions réellement alimentées apparaissent au tableau de bord. */
  activeKeys(): MetricKey[] {
    return this.db
      .prepare<[], { key: string }>(
        'SELECT key, COUNT(*) AS n FROM metrics GROUP BY key HAVING n >= 3 ORDER BY n DESC',
      )
      .all()
      .map((row) => row.key);
  }

  /** Tendances significatives — matière première des initiatives. */
  significantTrends(windowDays = 7, minZ = 1.1): MetricTrend[] {
    return this.activeKeys()
      .map((key) => this.trend(key, windowDays))
      .filter((trend) => trend.sampleSize >= 3 && Math.abs(trend.zScore) >= minZ)
      .sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
  }
}

/** Décale une clé `YYYY-MM-DD` de N jours. */
function shiftDay(day: string, offset: number): string {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + offset);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const dayOfMonth = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${dayOfMonth}`;
}
