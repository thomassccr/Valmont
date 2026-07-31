import type { EntityId, InitiativeId, MemoryId, Timestamp } from './ids.js';

/**
 * Une initiative est une prise de parole que Valmont décide *lui-même*.
 * C'est la différence entre un chatbot et un agent : personne ne la demande.
 *
 * Elle est toujours étayée (`evidence`) et toujours réversible (l'utilisateur
 * peut la rejeter, ce qui alimente l'apprentissage des préférences).
 */
export type InitiativeKind =
  /** « Tu n'as pas parlé de Vintex depuis 10 jours. » */
  | 'dormant_project'
  /** « Tu travailles beaucoup moins cette semaine. » */
  | 'trend_shift'
  /** « Tu m'avais dit X, là tu dis Y. » */
  | 'contradiction'
  /** « Tu sembles plus motivé le matin. » */
  | 'pattern_insight'
  /** « Tu avais décidé de faire ça lundi. » */
  | 'commitment_followup'
  /** « Cette idée dort depuis 3 semaines, on la lance ou on la tue ? » */
  | 'idea_review'
  /** Question posée pour combler un trou dans la mémoire. */
  | 'curiosity'
  /** Confrontation directe demandée par l'utilisateur (challenge). */
  | 'challenge'
  /** Proposition de priorité pour maintenant. */
  | 'focus_suggestion'
  /** Célébration d'un progrès réel. */
  | 'progress';

export type InitiativeStatus =
  | 'pending'
  | 'scheduled'
  | 'delivered'
  | 'acted'
  | 'dismissed'
  | 'expired';

export interface Initiative {
  id: InitiativeId;
  kind: InitiativeKind;
  /** Formulation courte destinée à être dite à voix haute. */
  title: string;
  /** Développement, si l'utilisateur creuse. */
  body?: string;
  /** Pourquoi Valmont pense ça — jamais montré tel quel, mais auditable. */
  rationale: string;

  /** 0-1. En dessous du seuil de confiance, l'initiative n'est pas livrée. */
  confidence: number;
  /** 0-1. Arbitre l'ordre de livraison quand plusieurs sont prêtes. */
  priority: number;

  evidence: {
    memoryIds?: MemoryId[];
    entityIds?: EntityId[];
    metricKeys?: string[];
  };

  status: InitiativeStatus;
  createdAt: Timestamp;
  /** Ne pas livrer avant cette date (respect du bon moment). */
  deliverAfter?: Timestamp;
  /** Périme automatiquement : une remarque en retard est une nuisance. */
  expiresAt?: Timestamp;
  deliveredAt?: Timestamp;
  resolvedAt?: Timestamp;

  /**
   * Clé de temporisation : deux initiatives partageant cette clé ne peuvent
   * pas être livrées dans la même fenêtre. Empêche Valmont d'être lourd.
   */
  cooldownKey: string;
  cooldownDays: number;
}

export type InitiativeDraft = Omit<
  Initiative,
  'id' | 'createdAt' | 'status' | 'deliveredAt' | 'resolvedAt'
> & {
  status?: InitiativeStatus;
};

/**
 * Règles d'étiquette de la prise de parole spontanée. Sans elles, un agent
 * proactif devient insupportable en une semaine — et on désinstalle.
 */
export interface ProactivityPolicy {
  /** Nombre maximum d'initiatives livrées par jour. */
  maxPerDay: number;
  /** Délai minimum entre deux prises de parole spontanées (ms). */
  minIntervalMs: number;
  /** Seuil de confiance en dessous duquel on se tait. */
  minConfidence: number;
  /** Plages horaires autorisées, format `HH:MM-HH:MM`. */
  quietHours: string[];
  /** Ne pas interrompre une session de travail profond détectée. */
  respectDeepWork: boolean;
}
