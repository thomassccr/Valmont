import { DAY, type Clock } from '@valmont/kernel';
import {
  newId,
  type Channel,
  type DomainEvent,
  type EventKind,
  type Message,
  type MessageId,
  type Role,
  type Session,
  type SessionId,
  type ToolCall,
} from '@valmont/types';
import { parseJson, toJson, type Db } from './db.js';

interface SessionRow {
  id: string;
  started_at: number;
  ended_at: number | null;
  channel: string;
  title: string | null;
  summary: string | null;
  message_count: number;
  mood: number | null;
  motivation: number | null;
  energy: number | null;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: number;
  channel: string;
  tool_calls: string | null;
  cited: string | null;
  meta: string | null;
}

/**
 * Journal : conversations et événements.
 *
 * Le journal d'événements est en ajout seul et fait autorité. Les tables de
 * mémoire, d'entités et de métriques en sont des projections : si l'extraction
 * change (nouveau modèle, meilleur prompt), on peut tout reconstruire sans
 * avoir rien perdu du passé. C'est la garantie qui rend le projet réellement
 * évolutif sur plusieurs années.
 */
export class Journal {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  // ── Événements ────────────────────────────────────────────────────────

  append(event: DomainEvent): void {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO events (id, kind, at, actor, trace_id, payload) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(event.id, event.kind, event.at, event.actor, event.traceId ?? null, toJson(event.payload));
  }

  events(options: { kinds?: EventKind[]; since?: number; limit?: number } = {}): DomainEvent[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (options.kinds?.length) {
      clauses.push(`kind IN (${options.kinds.map(() => '?').join(',')})`);
      params.push(...options.kinds);
    }
    if (options.since !== undefined) {
      clauses.push('at >= ?');
      params.push(options.since);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(options.limit ?? 200);

    return this.db
      .prepare<unknown[], {
        id: string;
        kind: string;
        at: number;
        actor: string;
        trace_id: string | null;
        payload: string;
      }>(`SELECT * FROM events ${where} ORDER BY at DESC LIMIT ?`)
      .all(...params)
      .map((row) => ({
        id: row.id,
        kind: row.kind as EventKind,
        at: row.at,
        actor: row.actor,
        ...(row.trace_id ? { traceId: row.trace_id } : {}),
        payload: parseJson<Record<string, unknown>>(row.payload, {}),
      }));
  }

  // ── Sessions ──────────────────────────────────────────────────────────

  startSession(channel: Channel): Session {
    const now = this.clock.now();
    const session: Session = {
      id: newId(now),
      startedAt: now,
      channel,
      messageCount: 0,
    };
    this.db
      .prepare('INSERT INTO sessions (id, started_at, channel, message_count) VALUES (?, ?, ?, 0)')
      .run(session.id, session.startedAt, session.channel);
    return session;
  }

  /**
   * Reprend la session en cours si elle est récente, sinon en ouvre une.
   * Une pause de 90 minutes marque un vrai changement de contexte ; en deçà,
   * c'est la même conversation qui reprend et elle doit garder son fil.
   */
  resumeOrStart(channel: Channel, maxIdleMs = 90 * 60 * 1000): Session {
    const now = this.clock.now();
    const row = this.db
      .prepare<[], SessionRow>(
        'SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
      )
      .get();

    if (row) {
      const lastMessage = this.db
        .prepare<[string], { created_at: number }>(
          'SELECT MAX(created_at) AS created_at FROM messages WHERE session_id = ?',
        )
        .get(row.id);
      const lastActivity = lastMessage?.created_at ?? row.started_at;
      if (now - lastActivity < maxIdleMs) return hydrateSession(row);
      this.endSession(row.id);
    }

    return this.startSession(channel);
  }

  endSession(id: SessionId, summary?: string): void {
    this.db
      .prepare('UPDATE sessions SET ended_at = ?, summary = coalesce(?, summary) WHERE id = ?')
      .run(this.clock.now(), summary ?? null, id);
  }

  getSession(id: SessionId): Session | null {
    const row = this.db.prepare<[string], SessionRow>('SELECT * FROM sessions WHERE id = ?').get(id);
    return row ? hydrateSession(row) : null;
  }

  setSessionAffect(
    id: SessionId,
    affect: { mood?: number; motivation?: number; energy?: number },
  ): void {
    this.db
      .prepare(
        `UPDATE sessions SET
           mood = coalesce(?, mood),
           motivation = coalesce(?, motivation),
           energy = coalesce(?, energy)
         WHERE id = ?`,
      )
      .run(affect.mood ?? null, affect.motivation ?? null, affect.energy ?? null, id);
  }

  setSessionTitle(id: SessionId, title: string): void {
    this.db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, id);
  }

  recentSessions(limit = 20): Session[] {
    return this.db
      .prepare<[number], SessionRow>('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?')
      .all(limit)
      .map(hydrateSession);
  }

  /** Sessions non encore résumées et terminées — file de la consolidation. */
  unsummarizedSessions(limit = 5): Session[] {
    return this.db
      .prepare<[number], SessionRow>(
        `SELECT * FROM sessions
         WHERE summary IS NULL AND ended_at IS NOT NULL AND message_count > 1
         ORDER BY started_at DESC LIMIT ?`,
      )
      .all(limit)
      .map(hydrateSession);
  }

  // ── Messages ──────────────────────────────────────────────────────────

  addMessage(input: {
    sessionId: SessionId;
    role: Role;
    content: string;
    channel: Channel;
    toolCalls?: ToolCall[];
    citedMemoryIds?: string[];
    meta?: Record<string, unknown>;
  }): Message {
    const now = this.clock.now();
    const message: Message = {
      id: newId(now),
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      createdAt: now,
      channel: input.channel,
      ...(input.toolCalls ? { toolCalls: input.toolCalls } : {}),
      ...(input.citedMemoryIds ? { citedMemoryIds: input.citedMemoryIds } : {}),
      ...(input.meta ? { meta: input.meta } : {}),
    };

    const insert = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO messages (id, session_id, role, content, created_at, channel, tool_calls, cited, meta)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          message.id,
          message.sessionId,
          message.role,
          message.content,
          message.createdAt,
          message.channel,
          message.toolCalls ? toJson(message.toolCalls) : null,
          message.citedMemoryIds ? toJson(message.citedMemoryIds) : null,
          message.meta ? toJson(message.meta) : null,
        );
      this.db
        .prepare('UPDATE sessions SET message_count = message_count + 1 WHERE id = ?')
        .run(message.sessionId);
    });
    insert();

    return message;
  }

  messages(sessionId: SessionId, limit = 50): Message[] {
    return this.db
      .prepare<[string, number], MessageRow>(
        'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?',
      )
      .all(sessionId, limit)
      .map(hydrateMessage)
      .reverse();
  }

  /** Derniers échanges tous canaux confondus — le « fil » de la journée. */
  recentMessages(limit = 30): Message[] {
    return this.db
      .prepare<[number], MessageRow>('SELECT * FROM messages ORDER BY created_at DESC LIMIT ?')
      .all(limit)
      .map(hydrateMessage)
      .reverse();
  }

  messagesBetween(from: number, to: number): Message[] {
    return this.db
      .prepare<[number, number], MessageRow>(
        'SELECT * FROM messages WHERE created_at >= ? AND created_at < ? ORDER BY created_at ASC',
      )
      .all(from, to)
      .map(hydrateMessage);
  }

  /** Activité par heure sur N jours — révèle les rythmes de travail. */
  activityByHour(days = 30): number[] {
    const since = this.clock.now() - days * DAY;
    const buckets = new Array<number>(24).fill(0);
    for (const row of this.db
      .prepare<[number], { created_at: number }>(
        `SELECT created_at FROM messages WHERE role = 'user' AND created_at >= ?`,
      )
      .all(since)) {
      const hour = Math.floor(this.clock.hourOfDay(row.created_at));
      buckets[hour] = (buckets[hour] ?? 0) + 1;
    }
    return buckets;
  }

  // ── Clé/valeur interne ────────────────────────────────────────────────

  getKv<T>(key: string, fallback: T): T {
    const row = this.db.prepare<[string], { value: string }>('SELECT value FROM kv WHERE key = ?').get(key);
    return parseJson<T>(row?.value, fallback);
  }

  setKv(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, toJson(value), this.clock.now());
  }
}

function hydrateSession(row: SessionRow): Session {
  return {
    id: row.id,
    startedAt: row.started_at,
    ...(row.ended_at ? { endedAt: row.ended_at } : {}),
    channel: row.channel as Channel,
    ...(row.title ? { title: row.title } : {}),
    ...(row.summary ? { summary: row.summary } : {}),
    messageCount: row.message_count,
    ...(row.mood !== null ? { mood: row.mood } : {}),
    ...(row.motivation !== null ? { motivation: row.motivation } : {}),
    ...(row.energy !== null ? { energy: row.energy } : {}),
  };
}

function hydrateMessage(row: MessageRow): Message {
  return {
    id: row.id as MessageId,
    sessionId: row.session_id,
    role: row.role as Role,
    content: row.content,
    createdAt: row.created_at,
    channel: row.channel as Channel,
    ...(row.tool_calls ? { toolCalls: parseJson<ToolCall[]>(row.tool_calls, []) } : {}),
    ...(row.cited ? { citedMemoryIds: parseJson<string[]>(row.cited, []) } : {}),
    ...(row.meta ? { meta: parseJson<Record<string, unknown>>(row.meta, {}) } : {}),
  };
}
