import type { EntityId, MemoryId, SessionId, ThemeId, Timestamp } from './ids.js';

/**
 * Les quatre natures de souvenir. Cette distinction n'est pas cosmétique :
 * chaque nature a sa propre vitesse d'oubli, sa propre stratégie de
 * récupération et son propre rôle dans la construction du contexte.
 */
export type MemoryKind =
  /** Ce qui s'est passé, daté. « Lundi il a dit qu'il abandonnait X. » */
  | 'episodic'
  /** Ce qui est vrai, atemporel. « Son objectif 2026 est 10k MRR. » */
  | 'semantic'
  /** Comment il fonctionne. « Il code mieux entre 6h et 10h. » */
  | 'procedural'
  /** Ce que Valmont a déduit lui-même en recoupant plusieurs souvenirs. */
  | 'reflective';

/**
 * Cycle de vie d'un souvenir. On ne supprime jamais : on déclasse.
 * Un souvenir « superseded » reste consultable (« qu'est-ce que je pensais
 * il y a trois semaines ? ») mais ne pollue plus le contexte courant.
 */
export type MemoryStatus = 'active' | 'superseded' | 'archived';

/**
 * Triplet optionnel. Quand une mémoire sémantique est exprimable sous forme
 * (sujet, prédicat, objet), on peut détecter les contradictions : deux
 * souvenirs actifs avec le même (sujet, prédicat) et un objet différent
 * signalent un changement d'avis — ou une incohérence à relever.
 */
export interface MemoryClaim {
  subject: string;
  predicate: string;
  object: string;
}

export interface Memory {
  id: MemoryId;
  kind: MemoryKind;
  status: MemoryStatus;

  /** Le souvenir, écrit en une phrase autoportante (lisible hors contexte). */
  content: string;
  /** Résumé court utilisé dans les listes et les rappels. */
  summary?: string;

  claim?: MemoryClaim;

  /** 0 → anecdotique, 1 → structurant. Évolue avec les rappels. */
  importance: number;
  /** 0 → Valmont extrapole, 1 → dit explicitement par l'utilisateur. */
  confidence: number;
  /** -1 (douloureux) → +1 (positif). Alimente la lecture émotionnelle. */
  valence: number;

  createdAt: Timestamp;
  /** Date de l'événement décrit, si différente de la date d'enregistrement. */
  occurredAt?: Timestamp;
  lastAccessedAt: Timestamp;
  accessCount: number;

  /** Vitesse d'oubli propre au souvenir (multiplie la constante du type). */
  decayRate: number;

  sessionId?: SessionId;
  /** Souvenir qui a remplacé celui-ci (changement d'avis, correction). */
  supersededBy?: MemoryId;
  /** Souvenirs sources, pour les mémoires réflexives. */
  derivedFrom?: MemoryId[];

  entityIds: EntityId[];
  themeIds: ThemeId[];

  /** Étiquettes libres, utiles pour les filtres rapides. */
  tags: string[];
}

export type MemoryDraft = Omit<
  Memory,
  | 'id'
  | 'createdAt'
  | 'lastAccessedAt'
  | 'accessCount'
  | 'status'
  | 'entityIds'
  | 'themeIds'
  | 'tags'
  | 'importance'
  | 'confidence'
  | 'valence'
  | 'decayRate'
> & {
  importance?: number;
  confidence?: number;
  valence?: number;
  decayRate?: number;
  entityIds?: EntityId[];
  tags?: string[];
};

/** Requête de récupération. Tous les champs sont des *biais*, pas des filtres durs. */
export interface MemoryQuery {
  /** Texte libre — sera vectorisé. */
  text?: string;
  /** Vecteur déjà calculé (évite un aller-retour d'embedding). */
  vector?: Float32Array;
  kinds?: MemoryKind[];
  entityIds?: EntityId[];
  themeIds?: ThemeId[];
  tags?: string[];
  since?: Timestamp;
  until?: Timestamp;
  /** Inclure les souvenirs déclassés (pour les questions rétrospectives). */
  includeSuperseded?: boolean;
  limit?: number;
  /** Poids de récupération, pour surcharger les valeurs par défaut. */
  weights?: Partial<RetrievalWeights>;
  /** 0 → pertinence pure, 1 → diversité maximale (MMR). */
  diversity?: number;
}

/**
 * Les poids du score de récupération. Exposés parce qu'ils doivent être
 * réglables : un rappel de type « de quoi on parlait ? » privilégie la
 * récence, une question de fond privilégie l'importance.
 */
export interface RetrievalWeights {
  semantic: number;
  recency: number;
  importance: number;
  frequency: number;
  entityOverlap: number;
  themeMomentum: number;
}

export interface ScoredMemory {
  memory: Memory;
  score: number;
  /** Détail du score — indispensable pour comprendre pourquoi Valmont a dit ça. */
  breakdown: RetrievalWeights & { total: number };
}

/**
 * Un thème est un centre de gravité qui émerge des souvenirs. Il n'est jamais
 * déclaré par l'utilisateur : il se forme, monte, puis retombe.
 */
export interface Theme {
  id: ThemeId;
  label: string;
  keywords: string[];
  firstSeenAt: Timestamp;
  lastSeenAt: Timestamp;
  mentionCount: number;
  /**
   * Dynamique du thème : > 0 il monte, < 0 il s'éteint. C'est ce signal qui
   * permet à Valmont de dire « le sport prend de plus en plus de place ».
   */
  momentum: number;
  /** Part du discours récent occupée par ce thème (0-1). */
  weight: number;
}
