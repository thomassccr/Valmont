import type { EntityId, MemoryId, RelationId, Timestamp } from './ids.js';

/**
 * Le graphe d'entités est la colonne vertébrale de la mémoire. Un souvenir
 * isolé se perd ; un souvenir accroché à « Vintex » se retrouve toujours.
 */
export type EntityType =
  | 'project'
  | 'company'
  | 'person'
  | 'goal'
  | 'habit'
  | 'idea'
  | 'decision'
  | 'skill'
  | 'tool'
  | 'place'
  | 'value'
  | 'event';

export type EntityStatus =
  | 'active'
  | 'paused'
  | 'done'
  | 'abandoned'
  /** Idée en attente : ni morte, ni lancée. Catégorie explicitement demandée. */
  | 'incubating';

export interface Entity {
  id: EntityId;
  type: EntityType;
  /** Nom d'affichage, tel que l'utilisateur le dit. */
  name: string;
  /** Clé de déduplication : `${type}:${slug(name)}`. Unique. */
  key: string;
  aliases: string[];
  description?: string;
  status: EntityStatus;

  /** Attributs libres, typés par convention selon `type`. */
  attributes: Record<string, unknown>;

  firstSeenAt: Timestamp;
  lastSeenAt: Timestamp;
  mentionCount: number;
  /** Importance courante de l'entité dans la vie de l'utilisateur (0-1). */
  salience: number;
}

export type EntityDraft = Pick<Entity, 'type' | 'name'> &
  Partial<Omit<Entity, 'id' | 'type' | 'name' | 'key'>>;

/**
 * Relations dirigées. Le prédicat est une chaîne libre normalisée
 * (`works_on`, `blocks`, `inspired_by`, `part_of`, `conflicts_with`…) :
 * une énumération fermée vieillirait mal.
 */
export interface Relation {
  id: RelationId;
  from: EntityId;
  to: EntityId;
  predicate: string;
  /** Force du lien, renforcée à chaque nouvelle observation. */
  weight: number;
  confidence: number;
  createdAt: Timestamp;
  lastSeenAt: Timestamp;
  sourceMemoryId?: MemoryId;
}

/** Vue agrégée d'une entité : ce que Valmont sait d'un projet, d'une personne… */
export interface EntityDossier {
  entity: Entity;
  relations: Array<{ relation: Relation; other: Entity }>;
  recentMemories: MemoryId[];
  /** Jours écoulés depuis la dernière mention. Base du « silence radio ». */
  daysSinceLastMention: number;
}
