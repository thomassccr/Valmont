import type { Clock } from './clock.js';
import { DAY } from './clock.js';
import type { Logger } from './logger.js';
import type { ScheduledJob } from './module.js';

/**
 * Planificateur simple et robuste. On évite volontairement une dépendance cron :
 * les besoins sont « toutes les N minutes » et « chaque jour à HH:MM », et une
 * boucle explicite est plus facile à raisonner qu'une expression cron.
 *
 * Points de robustesse :
 *  - une tâche qui plante ne tue pas le planificateur ;
 *  - une tâche déjà en cours n'est jamais lancée deux fois en parallèle ;
 *  - l'arrêt annule proprement via `AbortSignal`.
 */
export class Scheduler {
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly running = new Set<string>();
  private readonly controller = new AbortController();
  private stopped = false;

  constructor(
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  add(job: ScheduledJob): void {
    if (this.stopped) return;

    if (job.onStartAfterMs !== undefined) {
      this.later(() => void this.execute(job), job.onStartAfterMs);
    }

    if (job.every !== undefined) {
      const timer = setInterval(() => void this.execute(job), job.every);
      timer.unref?.();
      this.timers.add(timer);
    }

    if (job.dailyAt) {
      this.scheduleDaily(job, job.dailyAt);
    }
  }

  private scheduleDaily(job: ScheduledJob, at: string): void {
    const [rawHour, rawMinute] = at.split(':');
    const hour = Number(rawHour ?? 0);
    const minute = Number(rawMinute ?? 0);

    const plan = (): void => {
      const now = this.clock.now();
      const target = new Date(now);
      target.setHours(hour, minute, 0, 0);
      let delay = target.getTime() - now;
      if (delay <= 0) delay += DAY;

      this.later(() => {
        void this.execute(job);
        plan(); // on replanifie après chaque exécution : pas de dérive
      }, delay);
    };

    plan();
  }

  private later(fn: () => void, ms: number): void {
    const timer = setTimeout(fn, ms);
    timer.unref?.();
    this.timers.add(timer);
  }

  private async execute(job: ScheduledJob): Promise<void> {
    if (this.stopped || this.running.has(job.name)) return;
    this.running.add(job.name);
    const startedAt = Date.now();
    try {
      await job.run(this.controller.signal);
      this.logger.debug('tâche terminée', { job: job.name, ms: Date.now() - startedAt });
    } catch (error) {
      this.logger.error('tâche en échec', { job: job.name, error: String(error) });
    } finally {
      this.running.delete(job.name);
    }
  }

  stop(): void {
    this.stopped = true;
    this.controller.abort();
    for (const timer of this.timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    this.timers.clear();
  }
}
