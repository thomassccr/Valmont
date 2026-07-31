import { type DomainEvent, type EventBus, type EventKind, newId } from '@valmont/types';
import type { Logger } from './logger.js';

type Handler = (event: DomainEvent<never>) => void | Promise<void>;

/**
 * Bus d'événements interne. Deux garanties importantes :
 *
 * 1. `emit` est **synchrone et ne lève jamais** — un abonné qui plante ne peut
 *    pas casser la conversation en cours.
 * 2. `drain` permet d'attendre la fin des traitements asynchrones, ce dont on
 *    a besoin à l'arrêt du processus pour ne perdre aucune écriture.
 */
export function createEventBus(logger?: Logger): EventBus {
  const handlers = new Map<string, Set<Handler>>();
  const pending = new Set<Promise<unknown>>();

  function subscribersFor(kind: EventKind): Handler[] {
    return [...(handlers.get(kind) ?? []), ...(handlers.get('*') ?? [])];
  }

  return {
    emit<P>(input: Omit<DomainEvent<P>, 'id' | 'at'> & { at?: number }): DomainEvent<P> {
      const at = input.at ?? Date.now();
      const event: DomainEvent<P> = { ...input, id: newId(at), at } as DomainEvent<P>;

      for (const handler of subscribersFor(event.kind)) {
        try {
          const outcome = handler(event as unknown as DomainEvent<never>);
          if (outcome instanceof Promise) {
            const tracked = outcome
              .catch((error: unknown) => {
                logger?.error('gestionnaire d’événement en échec', {
                  kind: event.kind,
                  error: String(error),
                });
              })
              .finally(() => pending.delete(tracked));
            pending.add(tracked);
          }
        } catch (error) {
          logger?.error('gestionnaire d’événement en échec', {
            kind: event.kind,
            error: String(error),
          });
        }
      }

      return event;
    },

    on<P>(kind: EventKind | '*', handler: (event: DomainEvent<P>) => void | Promise<void>) {
      const set = handlers.get(kind) ?? new Set<Handler>();
      set.add(handler as Handler);
      handlers.set(kind, set);
      return () => {
        set.delete(handler as Handler);
      };
    },

    async drain(): Promise<void> {
      // Boucle : un gestionnaire peut lui-même émettre des événements.
      while (pending.size > 0) {
        await Promise.allSettled([...pending]);
      }
    },
  };
}
