import type { Clock, Logger, ValmontConfig } from '@valmont/kernel';
import type { EmbeddingProvider } from '@valmont/llm';
import type {
  DomainEvent,
  EventBus,
  Memory,
  MemoryDraft,
  MemoryQuery,
  ScoredMemory,
} from '@valmont/types';
import { openDatabase, type Db } from './db.js';
import { EntityStore } from './entities.js';
import { InitiativeStore } from './initiatives.js';
import { Journal } from './journal.js';
import { MemoryStore } from './memories.js';
import { MetricStore } from './metrics.js';
import { ProfileStore } from './profile.js';
import { ThemeStore } from './themes.js';
import { InMemoryVectorIndex } from './vectors.js';

export interface MemoryEngineDeps {
  config: ValmontConfig;
  embeddings: EmbeddingProvider;
  clock: Clock;
  bus: EventBus;
  logger: Logger;
}

/**
 * Façade de la mémoire.
 *
 * Un seul objet à passer aux agents et au serveur, et un seul endroit où les
 * sous-systèmes se coordonnent (écrire un souvenir doit aussi le rattacher à
 * un thème, par exemple — l'appelant n'a pas à le savoir).
 */
export class MemoryEngine {
  readonly db: Db;
  readonly vectors: InMemoryVectorIndex;
  readonly memories: MemoryStore;
  readonly entities: EntityStore;
  readonly themes: ThemeStore;
  readonly metrics: MetricStore;
  readonly initiatives: InitiativeStore;
  readonly journal: Journal;
  readonly profile: ProfileStore;

  private readonly logger: Logger;
  private readonly embeddings: EmbeddingProvider;

  constructor(deps: MemoryEngineDeps) {
    const { config, embeddings, clock, bus, logger } = deps;
    this.logger = logger.child('memory');
    this.embeddings = embeddings;

    this.db = openDatabase(config.paths.db, this.logger);
    this.vectors = new InMemoryVectorIndex(this.db);

    // Changer de modèle d'embedding invalide tout l'index : des vecteurs de
    // modèles différents ne sont pas comparables et produiraient des rappels
    // faux, silencieusement. On préfère reconstruire.
    const previousModel = this.vectors.model();
    if (previousModel && previousModel !== embeddings.model) {
      this.logger.warn('modèle d’embedding changé, réindexation nécessaire', {
        from: previousModel,
        to: embeddings.model,
      });
      this.vectors.reset(embeddings.model);
    }

    this.journal = new Journal(this.db, clock);
    this.entities = new EntityStore(this.db, clock, bus, this.logger);
    this.memories = new MemoryStore({
      db: this.db,
      vectors: this.vectors,
      embeddings,
      clock,
      bus,
      logger: this.logger,
    });
    this.themes = new ThemeStore(this.db, this.vectors, embeddings, clock, bus, this.logger);
    this.metrics = new MetricStore(this.db, clock, bus);
    this.initiatives = new InitiativeStore(this.db, clock, bus, this.logger);
    this.profile = new ProfileStore(this.db, clock, bus);

    // Le journal capte tout : c'est lui qui rend les projections reconstructibles.
    bus.on('*', (event: DomainEvent) => {
      this.journal.append(event);
    });
  }

  /**
   * Écrit un souvenir et le raccroche au reste : entités, thème, index.
   * Point d'entrée unique — écrire directement via `memories.write` laisserait
   * le souvenir orphelin de tout thème.
   */
  async remember(draft: MemoryDraft): Promise<Memory> {
    const memory = await this.memories.write(draft);
    const vector = this.vectors.get('memory', memory.id);
    const themeId = this.themes.attach(memory.id, memory.content, vector);
    return themeId ? { ...memory, themeIds: [themeId] } : memory;
  }

  recall(query: MemoryQuery): Promise<ScoredMemory[]> {
    return this.memories.search(query);
  }

  /**
   * Entretien nocturne. Ordre volontaire : on rattrape d'abord les vecteurs
   * manquants (tout le reste en dépend), puis on consolide les thèmes, puis on
   * fait décroître, puis on oublie.
   */
  async maintenance(): Promise<void> {
    await this.memories.backfillEmbeddings();
    this.themes.consolidate();
    this.themes.recompute();
    this.entities.decaySalience();
    this.memories.forgetPass();
    this.db.pragma('optimize');
    this.logger.info('entretien de la mémoire terminé');
  }

  stats(): {
    memories: number;
    entities: number;
    vectors: number;
    since: number | null;
    embeddingModel: string;
  } {
    return {
      memories: this.memories.count(),
      entities: this.entities.count(),
      vectors: this.vectors.size('memory'),
      since: this.memories.oldestAt(),
      embeddingModel: this.embeddings.model,
    };
  }

  /** Sauvegarde à chaud — SQLite gère la cohérence, aucune interruption. */
  async backup(path: string): Promise<void> {
    await this.db.backup(path);
    this.logger.info('sauvegarde effectuée', { path });
  }

  close(): void {
    this.db.pragma('wal_checkpoint(TRUNCATE)');
    this.db.close();
  }
}
