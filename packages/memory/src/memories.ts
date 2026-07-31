import {
  DAY,
  clamp,
  decay,
  keywords,
  mmr,
  type Clock,
  type Logger,
} from '@valmont/kernel';
import type { EmbeddingProvider } from '@valmont/llm';
import {
  newId,
  type EventBus,
  type Memory,
  type MemoryDraft,
  type MemoryId,
  type MemoryKind,
  type MemoryQuery,
  type MemoryStatus,
  type RetrievalWeights,
  type ScoredMemory,
} from '@valmont/types';
import { parseJson, toJson, type Db } from './db.js';
import type { VectorIndex } from './vectors.js';

/**
 * Demi-vies par nature de souvenir : c'est la traduction chiffrée de
 * « certaines choses s'oublient vite, d'autres jamais ».
 *
 * Un détail de mardi dernier cesse d'être saillant en deux semaines.
 * Une valeur personnelle reste pertinente des années. Sans cette distinction,
 * soit Valmont noie le contexte sous l'anecdote récente, soit il ressort des
 * banalités d'il y a six mois.
 */
const HALF_LIFE: Record<MemoryKind, number> = {
  episodic: 14 * DAY,
  reflective: 90 * DAY,
  semantic: 180 * DAY,
  procedural: 365 * DAY,
};

export const DEFAULT_WEIGHTS: RetrievalWeights = {
  semantic: 1.0,
  recency: 0.45,
  importance: 0.55,
  frequency: 0.2,
  entityOverlap: 0.5,
  themeMomentum: 0.25,
};

interface MemoryRow {
  id: string;
  kind: string;
  status: string;
  content: string;
  summary: string | null;
  subject: string | null;
  predicate: string | null;
  object: string | null;
  importance: number;
  confidence: number;
  valence: number;
  decay_rate: number;
  created_at: number;
  occurred_at: number | null;
  last_accessed_at: number;
  access_count: number;
  session_id: string | null;
  superseded_by: string | null;
  derived_from: string;
  tags: string;
}

export interface MemoryStoreDeps {
  db: Db;
  vectors: VectorIndex;
  embeddings: EmbeddingProvider;
  clock: Clock;
  bus: EventBus;
  logger: Logger;
}

export class MemoryStore {
  private readonly db: Db;
  private readonly vectors: VectorIndex;
  private readonly embeddings: EmbeddingProvider;
  private readonly clock: Clock;
  private readonly bus: EventBus;
  private readonly logger: Logger;

  constructor(deps: MemoryStoreDeps) {
    this.db = deps.db;
    this.vectors = deps.vectors;
    this.embeddings = deps.embeddings;
    this.clock = deps.clock;
    this.bus = deps.bus;
    this.logger = deps.logger;
  }

  // ── Écriture ──────────────────────────────────────────────────────────

  /**
   * Enregistre un souvenir.
   *
   * Trois choses se passent au-delà de l'insertion :
   *  1. **Déduplication** : un souvenir quasi identique récent est fusionné
   *     (importance renforcée) au lieu d'être dupliqué. Sans ça, dire trois
   *     fois la même chose créerait trois souvenirs qui monopoliseraient
   *     ensuite le contexte.
   *  2. **Détection de contradiction** : si un souvenir actif porte le même
   *     (sujet, prédicat) avec un objet différent, l'ancien est déclassé et un
   *     événement est émis — c'est la matière première du « tu m'avais dit X ».
   *  3. **Vectorisation** : immédiate, pour que le souvenir soit retrouvable
   *     dès le tour suivant.
   */
  async write(draft: MemoryDraft): Promise<Memory> {
    const now = this.clock.now();

    const existing = await this.findDuplicate(draft, now);
    if (existing) {
      return this.reinforce(existing.id, draft.importance ?? existing.importance);
    }

    const memory: Memory = {
      id: newId(now),
      kind: draft.kind,
      status: 'active',
      content: draft.content.trim(),
      ...(draft.summary ? { summary: draft.summary } : {}),
      ...(draft.claim ? { claim: draft.claim } : {}),
      importance: clamp(draft.importance ?? 0.5),
      confidence: clamp(draft.confidence ?? 0.8),
      valence: clamp(draft.valence ?? 0, -1, 1),
      decayRate: draft.decayRate ?? 1,
      createdAt: now,
      ...(draft.occurredAt ? { occurredAt: draft.occurredAt } : {}),
      lastAccessedAt: now,
      accessCount: 0,
      ...(draft.sessionId ? { sessionId: draft.sessionId } : {}),
      ...(draft.derivedFrom ? { derivedFrom: draft.derivedFrom } : {}),
      entityIds: draft.entityIds ?? [],
      themeIds: [],
      tags: draft.tags ?? [],
    };

    this.db
      .prepare(
        `INSERT INTO memories (
           id, kind, status, content, summary, subject, predicate, object,
           importance, confidence, valence, decay_rate, created_at, occurred_at,
           last_accessed_at, access_count, session_id, derived_from, tags
         ) VALUES (
           @id, @kind, @status, @content, @summary, @subject, @predicate, @object,
           @importance, @confidence, @valence, @decayRate, @createdAt, @occurredAt,
           @lastAccessedAt, 0, @sessionId, @derivedFrom, @tags
         )`,
      )
      .run({
        id: memory.id,
        kind: memory.kind,
        status: memory.status,
        content: memory.content,
        summary: memory.summary ?? null,
        subject: memory.claim?.subject ?? null,
        predicate: memory.claim?.predicate ?? null,
        object: memory.claim?.object ?? null,
        importance: memory.importance,
        confidence: memory.confidence,
        valence: memory.valence,
        decayRate: memory.decayRate,
        createdAt: memory.createdAt,
        occurredAt: memory.occurredAt ?? null,
        lastAccessedAt: memory.lastAccessedAt,
        sessionId: memory.sessionId ?? null,
        derivedFrom: toJson(memory.derivedFrom ?? []),
        tags: toJson(memory.tags),
      });

    this.linkEntities(memory.id, memory.entityIds);
    await this.embed(memory);

    if (memory.claim) this.detectContradiction(memory);

    this.bus.emit({
      kind: 'memory.written',
      actor: 'memory',
      payload: { id: memory.id, kind: memory.kind, content: memory.content },
    });

    return memory;
  }

  /**
   * Fusion des quasi-doublons.
   *
   * La fenêtre de comparaison dépend de la nature du souvenir, et cette
   * distinction est essentielle :
   *
   *  - **Épisodique** : un événement est daté. « Séance de sport ce matin »
   *    lundi et le même mardi sont deux séances, pas un doublon — les fusionner
   *    effacerait littéralement des jours de la vie de l'utilisateur et
   *    fausserait toutes les séries d'habitudes. On ne compare donc que dans
   *    une fenêtre de 12 heures autour du moment décrit.
   *  - **Sémantique / procédural / réflexif** : un fait redit reste le même
   *    fait. On compare sur 30 jours, et la redite renforce l'importance.
   */
  private async findDuplicate(draft: MemoryDraft, now: number): Promise<Memory | null> {
    const vector = await this.vectorFor(draft.content);
    if (!vector) return null;

    const at = draft.occurredAt ?? now;
    const window = draft.kind === 'episodic' ? 12 * 60 * 60 * 1000 : 30 * DAY;

    const candidates = new Set(
      this.db
        .prepare<[string, number, number], { id: string }>(
          `SELECT id FROM memories
           WHERE status = 'active' AND kind = ?
             AND abs(coalesce(occurred_at, created_at) - ?) <= ?`,
        )
        .all(draft.kind, at, window)
        .map((row) => row.id),
    );
    if (candidates.size === 0) return null;

    const [top] = this.vectors.search('memory', vector, 1, candidates);
    // 0,94 : au-dessus, c'est la même idée reformulée ; en dessous, c'est une
    // nuance qui mérite son propre souvenir.
    if (!top || top.score < 0.94) return null;

    return this.get(top.id);
  }

  /**
   * Un souvenir contredit un précédent : on déclasse l'ancien plutôt que de
   * l'effacer. « Qu'est-ce que je pensais il y a trois semaines ? » doit rester
   * répondable.
   */
  private detectContradiction(memory: Memory): void {
    if (!memory.claim) return;

    const conflicts = this.db
      .prepare<[string, string, string, string], MemoryRow>(
        `SELECT * FROM memories
         WHERE status = 'active' AND subject = ? AND predicate = ?
           AND object IS NOT ? AND id != ?`,
      )
      .all(memory.claim.subject, memory.claim.predicate, memory.claim.object, memory.id);

    for (const row of conflicts) {
      this.db
        .prepare(`UPDATE memories SET status = 'superseded', superseded_by = ? WHERE id = ?`)
        .run(memory.id, row.id);

      this.bus.emit({
        kind: 'contradiction.detected',
        actor: 'memory',
        payload: {
          subject: memory.claim.subject,
          predicate: memory.claim.predicate,
          before: row.object,
          after: memory.claim.object,
          previousMemoryId: row.id,
          currentMemoryId: memory.id,
          previousAt: row.created_at,
        },
      });
    }
  }

  private linkEntities(memoryId: MemoryId, entityIds: string[]): void {
    if (entityIds.length === 0) return;
    const statement = this.db.prepare(
      'INSERT OR IGNORE INTO memory_entities (memory_id, entity_id) VALUES (?, ?)',
    );
    for (const entityId of entityIds) statement.run(memoryId, entityId);
  }

  private async embed(memory: Memory): Promise<void> {
    const vector = await this.vectorFor(memory.summary ?? memory.content);
    if (vector) {
      this.vectors.put('memory', memory.id, vector, this.embeddings.model);
    }
  }

  private async vectorFor(text: string): Promise<Float32Array | null> {
    try {
      const [vector] = await this.embeddings.embed([text]);
      return vector ?? null;
    } catch (error) {
      // Un embedding raté ne doit jamais perdre un souvenir : il est écrit en
      // base et reste retrouvable en plein texte. Une passe de rattrapage le
      // vectorisera plus tard.
      this.logger.warn('vectorisation en échec, souvenir conservé sans vecteur', {
        error: String(error),
      });
      return null;
    }
  }

  // ── Lecture ───────────────────────────────────────────────────────────

  get(id: MemoryId): Memory | null {
    const row = this.db
      .prepare<[string], MemoryRow>('SELECT * FROM memories WHERE id = ?')
      .get(id);
    return row ? this.hydrate(row) : null;
  }

  /**
   * Récupération hybride. Trois sources de candidats, fusionnées puis notées :
   *
   *  - **vectorielle** : capture le sens (« je suis crevé » ↔ « fatigue ») ;
   *  - **plein texte** : capture les noms propres et le vocabulaire rare, que
   *    les embeddings diluent (« Vintex » n'est proche de rien) ;
   *  - **graphe d'entités** : tout ce qui est rattaché aux entités citées.
   *
   * Aucune des trois ne suffit seule. La recherche vectorielle pure rate les
   * noms de projets ; la recherche plein texte pure rate les paraphrases.
   */
  async search(query: MemoryQuery): Promise<ScoredMemory[]> {
    const now = this.clock.now();
    const limit = query.limit ?? 12;
    const weights = { ...DEFAULT_WEIGHTS, ...query.weights };

    const vector = query.vector ?? (query.text ? await this.vectorFor(query.text) : null);
    const candidateIds = new Set<string>();

    // 1. Voisinage vectoriel — large, on filtrera au scoring.
    if (vector) {
      for (const hit of this.vectors.search('memory', vector, limit * 8)) {
        candidateIds.add(hit.id);
      }
    }

    // 2. Plein texte.
    if (query.text) {
      for (const id of this.fullTextSearch(query.text, limit * 4)) candidateIds.add(id);
    }

    // 3. Entités et thèmes explicitement demandés.
    for (const id of this.byEntities(query.entityIds ?? [], limit * 4)) candidateIds.add(id);
    for (const id of this.byThemes(query.themeIds ?? [], limit * 3)) candidateIds.add(id);

    // 4. Filet de sécurité : si rien ne ressort (base neuve, requête vague),
    //    on prend les souvenirs structurants récents plutôt que rien.
    if (candidateIds.size === 0) {
      for (const row of this.db
        .prepare<[string], { id: string }>(
          `SELECT id FROM memories WHERE status = 'active'
           ORDER BY importance DESC, created_at DESC LIMIT ?`,
        )
        .all(String(limit * 2))) {
        candidateIds.add(row.id);
      }
    }

    if (candidateIds.size === 0) return [];

    const rows = this.loadRows([...candidateIds], query);
    const themeMomentum = this.themeMomentumByMemory([...candidateIds]);
    const queryEntities = new Set(query.entityIds ?? []);
    const queryKeywords = query.text ? keywords(query.text) : [];

    const scored: ScoredMemory[] = rows.map((row) => {
      const memory = this.hydrate(row);
      const memoryVector = this.vectors.get('memory', memory.id);

      // Sans vecteur (embedding raté, ou requête sans texte), on retombe sur
      // un recouvrement lexical : dégradé mais jamais nul.
      const semantic = vector && memoryVector
        ? clamp((cosine(vector, memoryVector) + 1) / 2)
        : lexicalOverlap(queryKeywords, memory.content);

      const age = now - (memory.occurredAt ?? memory.createdAt);
      const recency = decay(age, HALF_LIFE[memory.kind] / Math.max(0.1, memory.decayRate));

      // Log pour éviter qu'un souvenir très rappelé écrase tout le reste.
      const frequency = clamp(Math.log1p(memory.accessCount) / Math.log(20));

      const overlap =
        queryEntities.size === 0
          ? 0
          : memory.entityIds.filter((id) => queryEntities.has(id)).length /
            queryEntities.size;

      const momentum = clamp(themeMomentum.get(memory.id) ?? 0);

      const breakdown = {
        semantic: semantic * weights.semantic,
        recency: recency * weights.recency,
        importance: memory.importance * weights.importance,
        frequency: frequency * weights.frequency,
        entityOverlap: overlap * weights.entityOverlap,
        themeMomentum: momentum * weights.themeMomentum,
        total: 0,
      };
      breakdown.total =
        breakdown.semantic +
        breakdown.recency +
        breakdown.importance +
        breakdown.frequency +
        breakdown.entityOverlap +
        breakdown.themeMomentum;

      // La confiance module le tout : une déduction incertaine ne doit pas
      // se présenter avec la même autorité qu'une phrase dite explicitement.
      const score = breakdown.total * (0.55 + 0.45 * memory.confidence);
      return { memory, score, breakdown };
    });

    // Diversification : sans MMR, une question sur « Vintex » remonte cinq
    // formulations du même fait et gâche le budget de contexte.
    const diversity = query.diversity ?? 0.4;
    const selected = mmr(
      scored.map((entry) => ({
        item: entry,
        score: entry.score,
        vector: this.vectors.get('memory', entry.memory.id),
      })),
      limit,
      diversity,
    );

    this.markRecalled(selected.map((entry) => entry.memory.id), now);
    return selected;
  }

  private loadRows(ids: string[], query: MemoryQuery): MemoryRow[] {
    const clauses: string[] = [`id IN (${ids.map(() => '?').join(',')})`];
    const params: unknown[] = [...ids];

    if (!query.includeSuperseded) clauses.push(`status = 'active'`);
    if (query.kinds?.length) {
      clauses.push(`kind IN (${query.kinds.map(() => '?').join(',')})`);
      params.push(...query.kinds);
    }
    if (query.since !== undefined) {
      clauses.push('coalesce(occurred_at, created_at) >= ?');
      params.push(query.since);
    }
    if (query.until !== undefined) {
      clauses.push('coalesce(occurred_at, created_at) <= ?');
      params.push(query.until);
    }

    const rows = this.db
      .prepare<unknown[], MemoryRow>(`SELECT * FROM memories WHERE ${clauses.join(' AND ')}`)
      .all(...params);

    if (!query.tags?.length) return rows;
    const wanted = new Set(query.tags);
    return rows.filter((row) =>
      parseJson<string[]>(row.tags, []).some((tag) => wanted.has(tag)),
    );
  }

  private fullTextSearch(text: string, limit: number): string[] {
    const terms = keywords(text, 8);
    if (terms.length === 0) return [];
    // Requête OR sur les termes signifiants, préfixée pour tolérer les flexions.
    const expression = terms.map((term) => `${term}*`).join(' OR ');
    try {
      return this.db
        .prepare<[string, number], { id: string }>(
          `SELECT m.id FROM memories_fts f
           JOIN memories m ON m.rowid = f.rowid
           WHERE memories_fts MATCH ? AND m.status = 'active'
           ORDER BY rank LIMIT ?`,
        )
        .all(expression, limit)
        .map((row) => row.id);
    } catch (error) {
      this.logger.debug('recherche plein texte ignorée', { error: String(error) });
      return [];
    }
  }

  private byEntities(entityIds: string[], limit: number): string[] {
    if (entityIds.length === 0) return [];
    return this.db
      .prepare<unknown[], { id: string }>(
        `SELECT m.id FROM memories m
         JOIN memory_entities me ON me.memory_id = m.id
         WHERE me.entity_id IN (${entityIds.map(() => '?').join(',')})
           AND m.status = 'active'
         ORDER BY m.importance DESC, m.created_at DESC LIMIT ?`,
      )
      .all(...entityIds, limit)
      .map((row) => row.id);
  }

  private byThemes(themeIds: string[], limit: number): string[] {
    if (themeIds.length === 0) return [];
    return this.db
      .prepare<unknown[], { memory_id: string }>(
        `SELECT memory_id FROM theme_memories
         WHERE theme_id IN (${themeIds.map(() => '?').join(',')})
         ORDER BY at DESC LIMIT ?`,
      )
      .all(...themeIds, limit)
      .map((row) => row.memory_id);
  }

  private themeMomentumByMemory(ids: string[]): Map<string, number> {
    const out = new Map<string, number>();
    if (ids.length === 0) return out;

    for (const row of this.db
      .prepare<unknown[], { memory_id: string; momentum: number }>(
        `SELECT tm.memory_id, MAX(t.momentum) AS momentum
         FROM theme_memories tm JOIN themes t ON t.id = tm.theme_id
         WHERE tm.memory_id IN (${ids.map(() => '?').join(',')})
         GROUP BY tm.memory_id`,
      )
      .all(...ids)) {
      out.set(row.memory_id, row.momentum);
    }
    return out;
  }

  /**
   * Renforcement par le rappel. Un souvenir effectivement utilisé devient plus
   * accessible — c'est ce qui fait qu'au fil des mois la mémoire se structure
   * autour de ce qui compte vraiment, sans qu'on ait rien à déclarer.
   */
  private markRecalled(ids: MemoryId[], now: number): void {
    if (ids.length === 0) return;
    this.db
      .prepare(
        `UPDATE memories
         SET access_count = access_count + 1,
             last_accessed_at = ?,
             importance = MIN(1.0, importance + 0.012)
         WHERE id IN (${ids.map(() => '?').join(',')})`,
      )
      .run(now, ...ids);
  }

  reinforce(id: MemoryId, importance?: number): Memory {
    const now = this.clock.now();
    this.db
      .prepare(
        `UPDATE memories
         SET access_count = access_count + 1,
             last_accessed_at = ?,
             importance = MAX(importance, ?),
             confidence = MIN(1.0, confidence + 0.05)
         WHERE id = ?`,
      )
      .run(now, importance ?? 0, id);
    const memory = this.get(id);
    if (!memory) throw new Error(`souvenir introuvable : ${id}`);
    return memory;
  }

  setStatus(id: MemoryId, status: MemoryStatus, supersededBy?: MemoryId): void {
    this.db
      .prepare('UPDATE memories SET status = ?, superseded_by = ? WHERE id = ?')
      .run(status, supersededBy ?? null, id);
  }

  // ── Entretien ─────────────────────────────────────────────────────────

  /**
   * Passe d'oubli. Ne supprime rien : archive les souvenirs épisodiques
   * anciens, peu importants et jamais rappelés. Ils restent interrogeables
   * explicitement, mais cessent de concurrencer le contexte courant.
   */
  forgetPass(): { archived: number } {
    const now = this.clock.now();
    const result = this.db
      .prepare(
        `UPDATE memories SET status = 'archived'
         WHERE status = 'active'
           AND kind = 'episodic'
           AND importance < 0.3
           AND access_count = 0
           AND created_at < ?`,
      )
      .run(now - 120 * DAY);

    if (result.changes > 0) {
      this.logger.info('passe d’oubli', { archived: result.changes });
    }
    return { archived: result.changes };
  }

  /** Rattrape les souvenirs écrits pendant une panne du service d'embeddings. */
  async backfillEmbeddings(limit = 200): Promise<number> {
    const rows = this.db
      .prepare<[number], MemoryRow>(
        `SELECT m.* FROM memories m
         LEFT JOIN embeddings e ON e.owner_kind = 'memory' AND e.owner_id = m.id
         WHERE e.owner_id IS NULL AND m.status != 'archived'
         ORDER BY m.importance DESC LIMIT ?`,
      )
      .all(limit);

    let done = 0;
    for (const row of rows) {
      const memory = this.hydrate(row);
      const vector = await this.vectorFor(memory.summary ?? memory.content);
      if (!vector) break; // le service est toujours indisponible, on réessaiera
      this.vectors.put('memory', memory.id, vector, this.embeddings.model);
      done++;
    }
    if (done > 0) this.logger.info('vecteurs rattrapés', { count: done });
    return done;
  }

  count(status: MemoryStatus = 'active'): number {
    const row = this.db
      .prepare<[string], { n: number }>('SELECT COUNT(*) AS n FROM memories WHERE status = ?')
      .get(status);
    return row?.n ?? 0;
  }

  oldestAt(): number | null {
    const row = this.db
      .prepare<[], { at: number | null }>('SELECT MIN(created_at) AS at FROM memories')
      .get();
    return row?.at ?? null;
  }

  recent(limit: number, kinds?: MemoryKind[]): Memory[] {
    const clause = kinds?.length ? `AND kind IN (${kinds.map(() => '?').join(',')})` : '';
    return this.db
      .prepare<unknown[], MemoryRow>(
        `SELECT * FROM memories WHERE status = 'active' ${clause}
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(...(kinds ?? []), limit)
      .map((row) => this.hydrate(row));
  }

  since(from: number, kinds?: MemoryKind[]): Memory[] {
    const clause = kinds?.length ? `AND kind IN (${kinds.map(() => '?').join(',')})` : '';
    return this.db
      .prepare<unknown[], MemoryRow>(
        `SELECT * FROM memories
         WHERE status = 'active' AND coalesce(occurred_at, created_at) >= ? ${clause}
         ORDER BY created_at DESC`,
      )
      .all(from, ...(kinds ?? []))
      .map((row) => this.hydrate(row));
  }

  private hydrate(row: MemoryRow): Memory {
    const entityIds = this.db
      .prepare<[string], { entity_id: string }>(
        'SELECT entity_id FROM memory_entities WHERE memory_id = ?',
      )
      .all(row.id)
      .map((entity) => entity.entity_id);

    const themeIds = this.db
      .prepare<[string], { theme_id: string }>(
        'SELECT theme_id FROM theme_memories WHERE memory_id = ?',
      )
      .all(row.id)
      .map((theme) => theme.theme_id);

    return {
      id: row.id,
      kind: row.kind as MemoryKind,
      status: row.status as MemoryStatus,
      content: row.content,
      ...(row.summary ? { summary: row.summary } : {}),
      ...(row.subject && row.predicate
        ? { claim: { subject: row.subject, predicate: row.predicate, object: row.object ?? '' } }
        : {}),
      importance: row.importance,
      confidence: row.confidence,
      valence: row.valence,
      decayRate: row.decay_rate,
      createdAt: row.created_at,
      ...(row.occurred_at ? { occurredAt: row.occurred_at } : {}),
      lastAccessedAt: row.last_accessed_at,
      accessCount: row.access_count,
      ...(row.session_id ? { sessionId: row.session_id } : {}),
      ...(row.superseded_by ? { supersededBy: row.superseded_by } : {}),
      derivedFrom: parseJson<string[]>(row.derived_from, []),
      entityIds,
      themeIds,
      tags: parseJson<string[]>(row.tags, []),
    };
  }
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
}

/** Repli lexical quand aucun vecteur n'est disponible. */
function lexicalOverlap(queryKeywords: string[], content: string): number {
  if (queryKeywords.length === 0) return 0.15;
  const contentWords = new Set(keywords(content, 40));
  const hits = queryKeywords.filter((word) => contentWords.has(word)).length;
  return clamp(hits / queryKeywords.length);
}
