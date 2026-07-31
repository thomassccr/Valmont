import type { EventBus } from '@valmont/types';
import type { ValmontConfig } from './config.js';
import type { Logger } from './logger.js';
import type { Clock } from './clock.js';

/**
 * Contrat de module. C'est le point d'extension central de Valmont :
 * ajouter « calendrier », « santé » ou « finances » ne doit demander
 * **aucune** modification du noyau, seulement un nouveau module enregistré.
 *
 * Un module peut :
 *  - déclarer des dépendances sur d'autres modules,
 *  - exposer des outils utilisables par les agents,
 *  - s'abonner au bus,
 *  - enregistrer des tâches planifiées,
 *  - contribuer des sections à l'invite système.
 */
export interface ModuleContext {
  config: ValmontConfig;
  logger: Logger;
  bus: EventBus;
  clock: Clock;
  /** Accès aux modules déjà démarrés (résolution par nom). */
  require<T>(name: string): T;
  /** Enregistre une tâche récurrente gérée par le planificateur du noyau. */
  schedule(job: ScheduledJob): void;
}

export interface ScheduledJob {
  name: string;
  /** Intervalle en millisecondes, ou expression `HH:MM` pour un rendez-vous quotidien. */
  every?: number;
  dailyAt?: string;
  /** Exécuter une fois au démarrage, après un délai. */
  onStartAfterMs?: number;
  run: (signal: AbortSignal) => Promise<void>;
}

export type ModuleStatus = 'ready' | 'degraded' | 'off';

export interface ValmontModule<API = unknown> {
  readonly name: string;
  readonly description: string;
  /** Modules qui doivent être démarrés avant celui-ci. */
  readonly dependsOn?: readonly string[];
  setup(context: ModuleContext): Promise<API> | API;
  /** Libération propre (fermeture de fichiers, arrêt des boucles). */
  teardown?(): Promise<void> | void;
  /** État rapporté à l'interface au démarrage. */
  status?(): { status: ModuleStatus; detail?: string };
}

/**
 * Registre : résout l'ordre de démarrage par tri topologique et refuse
 * les cycles de dépendances explicitement plutôt que de boucler.
 */
export class ModuleRegistry {
  private readonly modules = new Map<string, ValmontModule<unknown>>();
  private readonly instances = new Map<string, unknown>();
  private readonly started: string[] = [];

  register(module: ValmontModule<unknown>): this {
    if (this.modules.has(module.name)) {
      throw new Error(`Module déjà enregistré : ${module.name}`);
    }
    this.modules.set(module.name, module);
    return this;
  }

  get<T>(name: string): T {
    if (!this.instances.has(name)) {
      throw new Error(`Module non démarré ou inconnu : ${name}`);
    }
    return this.instances.get(name) as T;
  }

  has(name: string): boolean {
    return this.instances.has(name);
  }

  list(): Array<{ name: string; status: ModuleStatus; detail?: string }> {
    return [...this.modules.values()].map((module) => {
      if (!this.instances.has(module.name)) return { name: module.name, status: 'off' as const };
      return { name: module.name, ...(module.status?.() ?? { status: 'ready' as const }) };
    });
  }

  private order(): ValmontModule<unknown>[] {
    const sorted: ValmontModule<unknown>[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (name: string, path: string[]): void => {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        throw new Error(`Cycle de dépendances entre modules : ${[...path, name].join(' → ')}`);
      }
      const module = this.modules.get(name);
      if (!module) throw new Error(`Dépendance de module introuvable : ${name}`);

      visiting.add(name);
      for (const dependency of module.dependsOn ?? []) visit(dependency, [...path, name]);
      visiting.delete(name);
      visited.add(name);
      sorted.push(module);
    };

    for (const name of this.modules.keys()) visit(name, []);
    return sorted;
  }

  async startAll(makeContext: (module: ValmontModule<unknown>) => ModuleContext): Promise<void> {
    for (const module of this.order()) {
      const instance = await module.setup(makeContext(module));
      this.instances.set(module.name, instance);
      this.started.push(module.name);
    }
  }

  /** Arrêt en ordre inverse du démarrage : les dépendances meurent en dernier. */
  async stopAll(logger?: Logger): Promise<void> {
    for (const name of [...this.started].reverse()) {
      try {
        await this.modules.get(name)?.teardown?.();
      } catch (error) {
        logger?.error('arrêt de module en échec', { module: name, error: String(error) });
      }
    }
    this.instances.clear();
    this.started.length = 0;
  }
}
