import type { EventId, Timestamp } from './ids.js';

/**
 * Le journal d'événements est la **source de vérité** du système. Les tables
 * de mémoire, de métriques et d'entités sont des projections : en cas de bug
 * d'extraction ou de changement de modèle, on peut tout reconstruire en
 * rejouant le journal, sans avoir rien perdu.
 *
 * Règle absolue : le journal est en ajout seul. On n'y écrase jamais rien.
 */
export type EventKind =
  | 'session.started'
  | 'session.ended'
  | 'message.received'
  | 'message.sent'
  | 'memory.written'
  | 'memory.superseded'
  | 'memory.recalled'
  | 'entity.created'
  | 'entity.updated'
  | 'relation.created'
  | 'metric.recorded'
  | 'initiative.created'
  | 'initiative.delivered'
  | 'initiative.resolved'
  | 'reflection.completed'
  | 'contradiction.detected'
  | 'theme.shifted'
  | 'document.indexed'
  | 'tool.invoked'
  | 'profile.updated'
  | 'system.error';

export interface DomainEvent<P = Record<string, unknown>> {
  id: EventId;
  kind: EventKind;
  at: Timestamp;
  /** Qui a produit l'événement : `user`, `valmont`, ou le nom d'un agent. */
  actor: string;
  payload: P;
  /** Corrélation : relie les événements d'un même tour de conversation. */
  traceId?: string;
}

/** Contrat du bus d'événements interne. */
export interface EventBus {
  emit<P>(event: Omit<DomainEvent<P>, 'id' | 'at'> & { at?: Timestamp }): DomainEvent<P>;
  on<P>(kind: EventKind | '*', handler: (event: DomainEvent<P>) => void | Promise<void>): () => void;
  /** Attend que tous les gestionnaires asynchrones en cours soient terminés. */
  drain(): Promise<void>;
}
