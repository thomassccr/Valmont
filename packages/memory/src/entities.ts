import { DAY, clamp, decay, slug, type Clock, type Logger } from '@valmont/kernel';
import {
  newId,
  type Entity,
  type EntityDossier,
  type EntityDraft,
  type EntityId,
  type EntityStatus,
  type EntityType,
  type EventBus,
  type Relation,
} from '@valmont/types';
import { parseJson, toJson, type Db } from './db.js';

interface EntityRow {
  id: string;
  type: string;
  name: string;
  key: string;
  aliases: string;
  description: string | null;
  status: string;
  attributes: string;
  first_seen_at: number;
  last_seen_at: number;
  mention_count: number;
  salience: number;
}

interface RelationRow {
  id: string;
  from_id: string;
  to_id: string;
  predicate: string;
  weight: number;
  confidence: number;
  created_at: number;
  last_seen_at: number;
  source_memory_id: string | null;
}

/**
 * Graphe d'entités.
 *
 * C'est ce qui permet de répondre à « où en est Vintex ? » sans que le mot
 * « Vintex » ait à apparaître dans la question, et de détecter les silences :
 * une entité qui cesse d'être mentionnée est une information en soi.
 */
export class EntityStore {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly bus: EventBus,
    private readonly logger: Logger,
  ) {}

  /**
   * Résout ou crée une entité. La déduplication passe par une clé canonique
   * `type:slug(nom)`, plus les alias : « Vintex », « vintex » et « le projet
   * Vintex » doivent converger, sinon la mémoire se fragmente en doublons et
   * plus rien ne se recoupe.
   */
  upsert(draft: EntityDraft): Entity {
    const now = this.clock.now();
    const key = `${draft.type}:${slug(draft.name)}`;

    const existing =
      this.db
        .prepare<[string], EntityRow>('SELECT * FROM entities WHERE key = ?')
        .get(key) ?? this.findByAlias(draft.type, draft.name);

    if (existing) {
      this.db
        .prepare(
          `UPDATE entities
           SET last_seen_at = ?, mention_count = mention_count + 1,
               salience = MIN(1.0, salience + 0.03),
               description = coalesce(?, description),
               status = coalesce(?, status)
           WHERE id = ?`,
        )
        .run(now, draft.description ?? null, draft.status ?? null, existing.id);

      if (draft.attributes) this.mergeAttributes(existing.id, draft.attributes);
      const updated = this.get(existing.id);
      if (!updated) throw new Error(`entité perdue après mise à jour : ${existing.id}`);
      return updated;
    }

    const entity: Entity = {
      id: newId(now),
      type: draft.type,
      name: draft.name.trim(),
      key,
      aliases: draft.aliases ?? [],
      ...(draft.description ? { description: draft.description } : {}),
      status: draft.status ?? 'active',
      attributes: draft.attributes ?? {},
      firstSeenAt: now,
      lastSeenAt: now,
      mentionCount: 1,
      salience: draft.salience ?? 0.5,
    };

    this.db
      .prepare(
        `INSERT INTO entities (
           id, type, name, key, aliases, description, status, attributes,
           first_seen_at, last_seen_at, mention_count, salience
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(
        entity.id,
        entity.type,
        entity.name,
        entity.key,
        toJson(entity.aliases),
        entity.description ?? null,
        entity.status,
        toJson(entity.attributes),
        entity.firstSeenAt,
        entity.lastSeenAt,
        entity.salience,
      );

    this.bus.emit({
      kind: 'entity.created',
      actor: 'memory',
      payload: { id: entity.id, type: entity.type, name: entity.name },
    });
    this.logger.debug('entité créée', { name: entity.name, type: entity.type });
    return entity;
  }

  private findByAlias(type: EntityType, name: string): EntityRow | undefined {
    const needle = slug(name);
    return this.db
      .prepare<[string], EntityRow>('SELECT * FROM entities WHERE type = ?')
      .all(type)
      .find((row) =>
        parseJson<string[]>(row.aliases, []).some((alias) => slug(alias) === needle),
      );
  }

  private mergeAttributes(id: EntityId, attributes: Record<string, unknown>): void {
    const row = this.db
      .prepare<[string], { attributes: string }>('SELECT attributes FROM entities WHERE id = ?')
      .get(id);
    const merged = { ...parseJson<Record<string, unknown>>(row?.attributes, {}), ...attributes };
    this.db.prepare('UPDATE entities SET attributes = ? WHERE id = ?').run(toJson(merged), id);
  }

  addAlias(id: EntityId, alias: string): void {
    const row = this.db
      .prepare<[string], { aliases: string }>('SELECT aliases FROM entities WHERE id = ?')
      .get(id);
    const aliases = new Set(parseJson<string[]>(row?.aliases, []));
    aliases.add(alias);
    this.db.prepare('UPDATE entities SET aliases = ? WHERE id = ?').run(toJson([...aliases]), id);
  }

  setStatus(id: EntityId, status: EntityStatus): void {
    this.db.prepare('UPDATE entities SET status = ? WHERE id = ?').run(status, id);
    this.bus.emit({ kind: 'entity.updated', actor: 'memory', payload: { id, status } });
  }

  get(id: EntityId): Entity | null {
    const row = this.db
      .prepare<[string], EntityRow>('SELECT * FROM entities WHERE id = ?')
      .get(id);
    return row ? hydrateEntity(row) : null;
  }

  /** Résolution souple par nom — utilisée par les outils des agents. */
  find(name: string, type?: EntityType): Entity | null {
    const needle = slug(name);
    const rows = type
      ? this.db.prepare<[string], EntityRow>('SELECT * FROM entities WHERE type = ?').all(type)
      : this.db.prepare<[], EntityRow>('SELECT * FROM entities').all();

    const exact = rows.find((row) => slug(row.name) === needle);
    if (exact) return hydrateEntity(exact);

    const aliased = rows.find((row) =>
      parseJson<string[]>(row.aliases, []).some((alias) => slug(alias) === needle),
    );
    if (aliased) return hydrateEntity(aliased);

    // Sous-chaîne : « le projet Vintex » doit atteindre « Vintex ».
    const partial = rows.find(
      (row) => needle.includes(slug(row.name)) || slug(row.name).includes(needle),
    );
    return partial ? hydrateEntity(partial) : null;
  }

  list(options: { type?: EntityType; status?: EntityStatus; limit?: number } = {}): Entity[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (options.type) {
      clauses.push('type = ?');
      params.push(options.type);
    }
    if (options.status) {
      clauses.push('status = ?');
      params.push(options.status);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(options.limit ?? 100);

    return this.db
      .prepare<unknown[], EntityRow>(
        `SELECT * FROM entities ${where} ORDER BY salience DESC, last_seen_at DESC LIMIT ?`,
      )
      .all(...params)
      .map(hydrateEntity);
  }

  relate(
    from: EntityId,
    to: EntityId,
    predicate: string,
    options: { confidence?: number; sourceMemoryId?: string } = {},
  ): Relation {
    const now = this.clock.now();
    // Une relation réobservée se renforce plutôt que de se dupliquer.
    this.db
      .prepare(
        `INSERT INTO relations (
           id, from_id, to_id, predicate, weight, confidence, created_at,
           last_seen_at, source_memory_id
         ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
         ON CONFLICT(from_id, to_id, predicate) DO UPDATE SET
           weight = MIN(10.0, weight + 0.5),
           confidence = MAX(confidence, excluded.confidence),
           last_seen_at = excluded.last_seen_at`,
      )
      .run(
        newId(now),
        from,
        to,
        predicate,
        options.confidence ?? 0.7,
        now,
        now,
        options.sourceMemoryId ?? null,
      );

    const row = this.db
      .prepare<[string, string, string], RelationRow>(
        'SELECT * FROM relations WHERE from_id = ? AND to_id = ? AND predicate = ?',
      )
      .get(from, to, predicate);
    if (!row) throw new Error('relation introuvable après insertion');

    this.bus.emit({
      kind: 'relation.created',
      actor: 'memory',
      payload: { from, to, predicate },
    });
    return hydrateRelation(row);
  }

  /** Vue complète d'une entité : ce que Valmont sait d'un projet ou d'une personne. */
  dossier(id: EntityId): EntityDossier | null {
    const entity = this.get(id);
    if (!entity) return null;

    const rows = this.db
      .prepare<[string, string], RelationRow>(
        'SELECT * FROM relations WHERE from_id = ? OR to_id = ? ORDER BY weight DESC LIMIT 40',
      )
      .all(id, id);

    const relations: EntityDossier['relations'] = [];
    for (const row of rows) {
      const otherId = row.from_id === id ? row.to_id : row.from_id;
      const other = this.get(otherId);
      if (other) relations.push({ relation: hydrateRelation(row), other });
    }

    const recentMemories = this.db
      .prepare<[string], { memory_id: string }>(
        `SELECT me.memory_id FROM memory_entities me
         JOIN memories m ON m.id = me.memory_id
         WHERE me.entity_id = ? AND m.status = 'active'
         ORDER BY m.created_at DESC LIMIT 20`,
      )
      .all(id)
      .map((row) => row.memory_id);

    return {
      entity,
      relations,
      recentMemories,
      daysSinceLastMention: Math.floor((this.clock.now() - entity.lastSeenAt) / DAY),
    };
  }

  /**
   * Entités actives devenues silencieuses. Base directe de l'initiative
   * « tu n'as pas parlé de Vintex depuis 10 jours ».
   *
   * Le seuil est pondéré par la saillance : un projet central mérite d'être
   * relevé après une semaine, une idée secondaire après un mois. Un seuil
   * unique produirait soit du harcèlement, soit du silence.
   */
  dormant(minDays = 7): Array<{ entity: Entity; days: number }> {
    const now = this.clock.now();
    return this.list({ status: 'active', limit: 200 })
      .filter((entity) => entity.type === 'project' || entity.type === 'goal')
      .map((entity) => ({ entity, days: Math.floor((now - entity.lastSeenAt) / DAY) }))
      .filter(({ entity, days }) => days >= minDays / Math.max(0.25, entity.salience))
      .sort((a, b) => b.entity.salience * b.days - a.entity.salience * a.days);
  }

  /**
   * Décroissance de la saillance. Sans elle, une entité très citée en janvier
   * resterait prioritaire en décembre : la mémoire se figerait sur le passé.
   */
  decaySalience(): void {
    const now = this.clock.now();
    const rows = this.db
      .prepare<[], { id: string; last_seen_at: number; salience: number }>(
        'SELECT id, last_seen_at, salience FROM entities',
      )
      .all();

    const update = this.db.prepare('UPDATE entities SET salience = ? WHERE id = ?');
    const apply = this.db.transaction(() => {
      for (const row of rows) {
        const factor = decay(now - row.last_seen_at, 45 * DAY);
        // Plancher à 0,05 : une entité ne disparaît jamais complètement.
        update.run(clamp(Math.max(0.05, row.salience * (0.35 + 0.65 * factor))), row.id);
      }
    });
    apply();
  }

  count(): number {
    const row = this.db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM entities').get();
    return row?.n ?? 0;
  }
}

function hydrateEntity(row: EntityRow): Entity {
  return {
    id: row.id,
    type: row.type as EntityType,
    name: row.name,
    key: row.key,
    aliases: parseJson<string[]>(row.aliases, []),
    ...(row.description ? { description: row.description } : {}),
    status: row.status as EntityStatus,
    attributes: parseJson<Record<string, unknown>>(row.attributes, {}),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    mentionCount: row.mention_count,
    salience: row.salience,
  };
}

function hydrateRelation(row: RelationRow): Relation {
  return {
    id: row.id,
    from: row.from_id,
    to: row.to_id,
    predicate: row.predicate,
    weight: row.weight,
    confidence: row.confidence,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    ...(row.source_memory_id ? { sourceMemoryId: row.source_memory_id } : {}),
  };
}
