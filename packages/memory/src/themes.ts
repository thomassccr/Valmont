import {
  DAY,
  centroid,
  clamp,
  cosineSimilarity,
  keywords,
  type Clock,
  type Logger,
} from '@valmont/kernel';
import type { EmbeddingProvider } from '@valmont/llm';
import { newId, type EventBus, type Theme, type ThemeId } from '@valmont/types';
import { parseJson, toJson, type Db } from './db.js';
import type { VectorIndex } from './vectors.js';

interface ThemeRow {
  id: string;
  label: string;
  keywords: string;
  first_seen_at: number;
  last_seen_at: number;
  mention_count: number;
  momentum: number;
  weight: number;
}

/** Au-delà de ce seuil, un souvenir rejoint un thème existant. */
const ATTACH_THRESHOLD = 0.62;
/** En dessous de ce nombre de souvenirs, un thème n'est pas un thème. */
const MIN_CLUSTER_SIZE = 3;

/**
 * Détection de thèmes.
 *
 * L'idée : un thème n'est jamais déclaré, il **émerge**. On fait du
 * regroupement incrémental — chaque souvenir rejoint le centre de gravité le
 * plus proche ou en crée un nouveau — puis on mesure la **dynamique** de
 * chaque groupe.
 *
 * La dynamique est le vrai signal. Savoir que l'utilisateur a parlé de sport
 * n'apprend rien ; savoir qu'il en parle trois fois plus qu'il y a un mois
 * dit qu'un changement est en cours. C'est ce qui permet à Valmont de dire
 * « la discipline prend de plus en plus de place chez toi » sans qu'on le lui
 * ait jamais soufflé.
 */
export class ThemeStore {
  constructor(
    private readonly db: Db,
    private readonly vectors: VectorIndex,
    private readonly embeddings: EmbeddingProvider,
    private readonly clock: Clock,
    private readonly bus: EventBus,
    private readonly logger: Logger,
  ) {}

  /**
   * Rattache un souvenir à un thème. Appelé après chaque écriture — c'est ce
   * qui rend le regroupement incrémental plutôt que recalculé de zéro.
   */
  attach(memoryId: string, content: string, vector: Float32Array | null): ThemeId | null {
    if (!vector) return null;
    const now = this.clock.now();

    const [nearest] = this.vectors.search('theme', vector, 1);

    if (nearest && nearest.score >= ATTACH_THRESHOLD) {
      this.db
        .prepare(
          'INSERT OR IGNORE INTO theme_memories (theme_id, memory_id, weight, at) VALUES (?, ?, ?, ?)',
        )
        .run(nearest.id, memoryId, nearest.score, now);
      this.db
        .prepare(
          'UPDATE themes SET last_seen_at = ?, mention_count = mention_count + 1 WHERE id = ?',
        )
        .run(now, nearest.id);
      this.refreshCentroid(nearest.id);
      return nearest.id;
    }

    // Aucun thème proche : on en ouvre un. Il restera « provisoire » (invisible
    // dans les vues) tant qu'il n'aura pas atteint MIN_CLUSTER_SIZE souvenirs.
    const id = newId(now);
    const label = keywords(content, 3).join(' · ') || 'divers';
    this.db
      .prepare(
        `INSERT INTO themes (id, label, keywords, first_seen_at, last_seen_at, mention_count, momentum, weight)
         VALUES (?, ?, ?, ?, ?, 1, 0, 0)`,
      )
      .run(id, label, toJson(keywords(content, 8)), now, now);
    this.db
      .prepare('INSERT INTO theme_memories (theme_id, memory_id, weight, at) VALUES (?, ?, 1, ?)')
      .run(id, memoryId, now);
    this.vectors.put('theme', id, vector, this.embeddings.model);
    return id;
  }

  /** Le centre de gravité suit le groupe : un thème peut dériver avec le temps. */
  private refreshCentroid(themeId: ThemeId): void {
    const memoryIds = this.db
      .prepare<[string], { memory_id: string }>(
        'SELECT memory_id FROM theme_memories WHERE theme_id = ? ORDER BY at DESC LIMIT 60',
      )
      .all(themeId)
      .map((row) => row.memory_id);

    const vectors = memoryIds
      .map((id) => this.vectors.get('memory', id))
      .filter((vector): vector is Float32Array => vector !== null);

    const center = centroid(vectors);
    if (center) this.vectors.put('theme', themeId, center, this.embeddings.model);
  }

  /**
   * Recalcule la dynamique de chaque thème.
   *
   * Comparaison d'une fenêtre courte (7 jours) à une fenêtre longue (28 jours),
   * normalisée par la durée. Le résultat vit dans [-1, 1] :
   *   +0,5  → deux fois plus présent que d'habitude, un sujet monte ;
   *   -0,5  → deux fois moins, un sujet s'éteint.
   */
  recompute(): Theme[] {
    const now = this.clock.now();
    const shortWindow = now - 7 * DAY;
    const longWindow = now - 28 * DAY;

    const themes = this.db.prepare<[], ThemeRow>('SELECT * FROM themes').all();
    const totalRecent =
      this.db
        .prepare<[number], { n: number }>(
          'SELECT COUNT(*) AS n FROM theme_memories WHERE at >= ?',
        )
        .get(shortWindow)?.n ?? 0;

    const update = this.db.prepare(
      'UPDATE themes SET momentum = ?, weight = ?, label = ?, keywords = ? WHERE id = ?',
    );
    const out: Theme[] = [];

    const apply = this.db.transaction(() => {
      for (const row of themes) {
        const recent =
          this.db
            .prepare<[string, number], { n: number }>(
              'SELECT COUNT(*) AS n FROM theme_memories WHERE theme_id = ? AND at >= ?',
            )
            .get(row.id, shortWindow)?.n ?? 0;

        const previous =
          this.db
            .prepare<[string, number, number], { n: number }>(
              'SELECT COUNT(*) AS n FROM theme_memories WHERE theme_id = ? AND at >= ? AND at < ?',
            )
            .get(row.id, longWindow, shortWindow)?.n ?? 0;

        // Taux journaliers, pour comparer des fenêtres de durées différentes.
        const recentRate = recent / 7;
        const previousRate = previous / 21;

        const momentum =
          previousRate === 0
            ? recentRate > 0
              ? clamp(recentRate, 0, 1) // apparition franche
              : 0
            : clamp((recentRate - previousRate) / (recentRate + previousRate), -1, 1);

        const weight = totalRecent === 0 ? 0 : recent / totalRecent;
        const { label, terms } = this.describe(row.id, row.label);

        update.run(momentum, weight, label, toJson(terms), row.id);

        const total =
          this.db
            .prepare<[string], { n: number }>(
              'SELECT COUNT(*) AS n FROM theme_memories WHERE theme_id = ?',
            )
            .get(row.id)?.n ?? 0;

        if (total < MIN_CLUSTER_SIZE) continue;

        out.push({
          id: row.id,
          label,
          keywords: terms,
          firstSeenAt: row.first_seen_at,
          lastSeenAt: row.last_seen_at,
          mentionCount: total,
          momentum,
          weight,
        });

        // Un thème qui bascule franchement à la hausse est une information :
        // on l'annonce pour que l'agent d'observation puisse s'en saisir.
        if (momentum > 0.45 && row.momentum <= 0.45 && total >= MIN_CLUSTER_SIZE) {
          this.bus.emit({
            kind: 'theme.shifted',
            actor: 'memory',
            payload: { id: row.id, label, momentum, direction: 'rising', mentions: total },
          });
        }
      }
    });

    apply();
    this.logger.debug('thèmes recalculés', { count: out.length });
    return out.sort((a, b) => b.weight - a.weight);
  }

  /** L'étiquette d'un thème se réécrit à partir de ses souvenirs les plus récents. */
  private describe(themeId: ThemeId, fallback: string): { label: string; terms: string[] } {
    const contents = this.db
      .prepare<[string], { content: string }>(
        `SELECT m.content FROM theme_memories tm
         JOIN memories m ON m.id = tm.memory_id
         WHERE tm.theme_id = ? ORDER BY tm.at DESC LIMIT 30`,
      )
      .all(themeId)
      .map((row) => row.content);

    if (contents.length === 0) return { label: fallback, terms: [] };
    const terms = keywords(contents.join(' '), 10);
    return { label: terms.slice(0, 3).join(' · ') || fallback, terms };
  }

  list(limit = 12): Theme[] {
    return this.db
      .prepare<[number, number], ThemeRow>(
        `SELECT t.* FROM themes t
         WHERE (SELECT COUNT(*) FROM theme_memories tm WHERE tm.theme_id = t.id) >= ?
         ORDER BY t.weight DESC, t.momentum DESC LIMIT ?`,
      )
      .all(MIN_CLUSTER_SIZE, limit)
      .map(hydrate);
  }

  /** Thèmes en nette progression — ce que Valmont doit remarquer tout seul. */
  rising(minMomentum = 0.35): Theme[] {
    return this.list(50).filter((theme) => theme.momentum >= minMomentum);
  }

  /** Thèmes qui s'éteignent — un abandon silencieux se voit ici. */
  fading(maxMomentum = -0.5): Theme[] {
    return this.list(50).filter((theme) => theme.momentum <= maxMomentum);
  }

  get(id: ThemeId): Theme | null {
    const row = this.db.prepare<[string], ThemeRow>('SELECT * FROM themes WHERE id = ?').get(id);
    return row ? hydrate(row) : null;
  }

  /**
   * Fusion des thèmes trop proches. Le regroupement incrémental dérive avec le
   * temps — deux thèmes peuvent converger sans jamais être rapprochés. Sans
   * cette passe, on finirait avec trois thèmes « sport » distincts.
   */
  consolidate(): number {
    const themes = this.db.prepare<[], ThemeRow>('SELECT * FROM themes').all();
    let merged = 0;

    for (let i = 0; i < themes.length; i++) {
      const a = themes[i];
      if (!a) continue;
      const vectorA = this.vectors.get('theme', a.id);
      if (!vectorA) continue;

      for (let j = i + 1; j < themes.length; j++) {
        const b = themes[j];
        if (!b) continue;
        const vectorB = this.vectors.get('theme', b.id);
        if (!vectorB) continue;

        if (cosineSimilarity(vectorA, vectorB) > 0.9) {
          this.db
            .prepare('UPDATE OR IGNORE theme_memories SET theme_id = ? WHERE theme_id = ?')
            .run(a.id, b.id);
          this.db.prepare('DELETE FROM themes WHERE id = ?').run(b.id);
          this.vectors.remove('theme', b.id);
          this.refreshCentroid(a.id);
          merged++;
        }
      }
    }

    if (merged > 0) this.logger.info('thèmes fusionnés', { merged });
    return merged;
  }
}

function hydrate(row: ThemeRow): Theme {
  return {
    id: row.id,
    label: row.label,
    keywords: parseJson<string[]>(row.keywords, []),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    mentionCount: row.mention_count,
    momentum: row.momentum,
    weight: row.weight,
  };
}
