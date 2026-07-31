import { DAY, HOUR, type Clock, type Logger } from '@valmont/kernel';
import {
  newId,
  type EventBus,
  type Initiative,
  type InitiativeDraft,
  type InitiativeId,
  type InitiativeKind,
  type InitiativeStatus,
  type ProactivityPolicy,
} from '@valmont/types';
import { parseJson, toJson, type Db } from './db.js';

interface InitiativeRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  rationale: string;
  confidence: number;
  priority: number;
  evidence: string;
  status: string;
  created_at: number;
  deliver_after: number | null;
  expires_at: number | null;
  delivered_at: number | null;
  resolved_at: number | null;
  cooldown_key: string;
  cooldown_days: number;
}

/**
 * Politique par défaut de prise de parole.
 *
 * Ces chiffres sont le vrai contrat social du produit. Un agent proactif mal
 * bridé devient une notification de plus, et on le coupe au bout d'une
 * semaine. Trois interventions par jour maximum, jamais deux dans la même
 * heure, rien avant 8h ni après 23h.
 */
export const DEFAULT_POLICY: ProactivityPolicy = {
  maxPerDay: 3,
  minIntervalMs: 90 * 60 * 1000,
  minConfidence: 0.55,
  quietHours: ['08:00-23:00'],
  respectDeepWork: true,
};

export class InitiativeStore {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly bus: EventBus,
    private readonly logger: Logger,
    private policy: ProactivityPolicy = DEFAULT_POLICY,
  ) {}

  setPolicy(policy: Partial<ProactivityPolicy>): void {
    this.policy = { ...this.policy, ...policy };
  }

  getPolicy(): ProactivityPolicy {
    return this.policy;
  }

  /**
   * Propose une initiative. Retourne `null` si la temporisation la bloque —
   * c'est volontairement silencieux : les agents proposent librement, la
   * politique décide, et ils n'ont pas à connaître les règles d'étiquette.
   */
  propose(draft: InitiativeDraft): Initiative | null {
    const now = this.clock.now();

    if (draft.confidence < this.policy.minConfidence) {
      this.logger.debug('initiative écartée (confiance)', {
        kind: draft.kind,
        confidence: draft.confidence,
      });
      return null;
    }

    if (this.inCooldown(draft.cooldownKey, draft.cooldownDays, now)) return null;

    // Une initiative identique déjà en attente : on garde la plus confiante.
    const pending = this.db
      .prepare<[string], InitiativeRow>(
        `SELECT * FROM initiatives WHERE cooldown_key = ? AND status IN ('pending','scheduled')`,
      )
      .get(draft.cooldownKey);
    if (pending) {
      if (pending.confidence >= draft.confidence) return null;
      this.db.prepare(`UPDATE initiatives SET status = 'expired' WHERE id = ?`).run(pending.id);
    }

    const initiative: Initiative = {
      id: newId(now),
      kind: draft.kind,
      title: draft.title,
      ...(draft.body ? { body: draft.body } : {}),
      rationale: draft.rationale,
      confidence: draft.confidence,
      priority: draft.priority,
      evidence: draft.evidence,
      status: draft.status ?? 'pending',
      createdAt: now,
      ...(draft.deliverAfter ? { deliverAfter: draft.deliverAfter } : {}),
      // Une remarque qui arrive trois semaines trop tard est une nuisance :
      // par défaut, tout périme au bout de deux semaines.
      expiresAt: draft.expiresAt ?? now + 14 * DAY,
      cooldownKey: draft.cooldownKey,
      cooldownDays: draft.cooldownDays,
    };

    this.db
      .prepare(
        `INSERT INTO initiatives (
           id, kind, title, body, rationale, confidence, priority, evidence,
           status, created_at, deliver_after, expires_at, cooldown_key, cooldown_days
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        initiative.id,
        initiative.kind,
        initiative.title,
        initiative.body ?? null,
        initiative.rationale,
        initiative.confidence,
        initiative.priority,
        toJson(initiative.evidence),
        initiative.status,
        initiative.createdAt,
        initiative.deliverAfter ?? null,
        initiative.expiresAt ?? null,
        initiative.cooldownKey,
        initiative.cooldownDays,
      );

    this.bus.emit({
      kind: 'initiative.created',
      actor: 'memory',
      payload: { id: initiative.id, kind: initiative.kind, title: initiative.title },
    });
    return initiative;
  }

  private inCooldown(key: string, days: number, now: number): boolean {
    const last = this.db
      .prepare<[string], { delivered_at: number | null }>(
        `SELECT delivered_at FROM initiatives
         WHERE cooldown_key = ? AND delivered_at IS NOT NULL
         ORDER BY delivered_at DESC LIMIT 1`,
      )
      .get(key);
    if (!last?.delivered_at) return false;
    return now - last.delivered_at < days * DAY;
  }

  /**
   * Prochaine initiative livrable, ou `null` si le moment n'est pas bon.
   * Toutes les règles d'étiquette sont appliquées ici, en un seul endroit.
   */
  nextDeliverable(options: { ignoreQuietHours?: boolean } = {}): Initiative | null {
    const now = this.clock.now();
    this.expireStale(now);

    if (!options.ignoreQuietHours && !this.withinQuietHours(now)) return null;
    if (this.deliveredToday(now) >= this.policy.maxPerDay) return null;

    const lastDelivered = this.db
      .prepare<[], { delivered_at: number }>(
        'SELECT MAX(delivered_at) AS delivered_at FROM initiatives WHERE delivered_at IS NOT NULL',
      )
      .get();
    if (lastDelivered?.delivered_at && now - lastDelivered.delivered_at < this.policy.minIntervalMs) {
      return null;
    }

    const row = this.db
      .prepare<[number, number], InitiativeRow>(
        `SELECT * FROM initiatives
         WHERE status IN ('pending','scheduled')
           AND (deliver_after IS NULL OR deliver_after <= ?)
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY priority DESC, confidence DESC, created_at ASC LIMIT 1`,
      )
      .get(now, now);

    return row ? hydrate(row) : null;
  }

  markDelivered(id: InitiativeId): void {
    const now = this.clock.now();
    this.db
      .prepare(`UPDATE initiatives SET status = 'delivered', delivered_at = ? WHERE id = ?`)
      .run(now, id);
    this.bus.emit({ kind: 'initiative.delivered', actor: 'valmont', payload: { id } });
  }

  /**
   * Résolution par l'utilisateur. Le signal est précieux : un rejet répété
   * d'un même type d'initiative doit finir par faire taire ce type. C'est ce
   * que consomme l'agent d'apprentissage via `dismissalRate`.
   */
  resolve(id: InitiativeId, outcome: 'acted' | 'dismissed'): void {
    const now = this.clock.now();
    this.db
      .prepare('UPDATE initiatives SET status = ?, resolved_at = ? WHERE id = ?')
      .run(outcome, now, id);
    this.bus.emit({ kind: 'initiative.resolved', actor: 'user', payload: { id, outcome } });
  }

  /** Taux de rejet par type — permet de calibrer la proactivité dans le temps. */
  dismissalRate(kind: InitiativeKind, days = 60): { rate: number; sample: number } {
    const since = this.clock.now() - days * DAY;
    const row = this.db
      .prepare<[string, number], { total: number; dismissed: number }>(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END) AS dismissed
         FROM initiatives
         WHERE kind = ? AND resolved_at IS NOT NULL AND resolved_at >= ?`,
      )
      .get(kind, since);

    const total = row?.total ?? 0;
    return { rate: total === 0 ? 0 : (row?.dismissed ?? 0) / total, sample: total };
  }

  pending(limit = 10): Initiative[] {
    const now = this.clock.now();
    return this.db
      .prepare<[number, number], InitiativeRow>(
        `SELECT * FROM initiatives
         WHERE status IN ('pending','scheduled')
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY priority DESC LIMIT ?`,
      )
      .all(now, limit)
      .map(hydrate);
  }

  recent(limit = 20): Initiative[] {
    return this.db
      .prepare<[number], InitiativeRow>(
        'SELECT * FROM initiatives ORDER BY created_at DESC LIMIT ?',
      )
      .all(limit)
      .map(hydrate);
  }

  private expireStale(now: number): void {
    this.db
      .prepare(
        `UPDATE initiatives SET status = 'expired'
         WHERE status IN ('pending','scheduled') AND expires_at IS NOT NULL AND expires_at <= ?`,
      )
      .run(now);
  }

  private deliveredToday(now: number): number {
    const row = this.db
      .prepare<[number], { n: number }>(
        'SELECT COUNT(*) AS n FROM initiatives WHERE delivered_at >= ?',
      )
      .get(this.clock.startOfDay(now));
    return row?.n ?? 0;
  }

  private withinQuietHours(now: number): boolean {
    if (this.policy.quietHours.length === 0) return true;
    const hour = this.clock.hourOfDay(now);

    return this.policy.quietHours.some((range) => {
      const [from, to] = range.split('-');
      const start = parseHour(from);
      const end = parseHour(to);
      if (start === null || end === null) return true;
      // Plage traversant minuit (ex. 22:00-06:00).
      return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
    });
  }

  /** Fenêtre de silence explicite — pendant le travail profond, par exemple. */
  suppressUntil(timestamp: number): void {
    this.db
      .prepare(
        `UPDATE initiatives SET deliver_after = MAX(coalesce(deliver_after, 0), ?)
         WHERE status IN ('pending','scheduled')`,
      )
      .run(timestamp);
  }

  /** Repousse d'une heure : utilisé quand une session de travail est détectée. */
  snoozeAll(): void {
    this.suppressUntil(this.clock.now() + HOUR);
  }
}

function parseHour(value: string | undefined): number | null {
  if (!value) return null;
  const [hours, minutes] = value.split(':').map(Number);
  if (hours === undefined || Number.isNaN(hours)) return null;
  return hours + (minutes ?? 0) / 60;
}

function hydrate(row: InitiativeRow): Initiative {
  return {
    id: row.id,
    kind: row.kind as InitiativeKind,
    title: row.title,
    ...(row.body ? { body: row.body } : {}),
    rationale: row.rationale,
    confidence: row.confidence,
    priority: row.priority,
    evidence: parseJson<Initiative['evidence']>(row.evidence, {}),
    status: row.status as InitiativeStatus,
    createdAt: row.created_at,
    ...(row.deliver_after ? { deliverAfter: row.deliver_after } : {}),
    ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
    ...(row.delivered_at ? { deliveredAt: row.delivered_at } : {}),
    ...(row.resolved_at ? { resolvedAt: row.resolved_at } : {}),
    cooldownKey: row.cooldown_key,
    cooldownDays: row.cooldown_days,
  };
}
