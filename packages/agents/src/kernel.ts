import type { Clock, Logger } from '@valmont/kernel';
import type { EmbeddingProvider, LLMProvider } from '@valmont/llm';
import type { MemoryEngine } from '@valmont/memory';
import type { EventBus } from '@valmont/types';

/**
 * Tout ce dont un agent a besoin. Un agent ne construit jamais ses propres
 * dépendances : il les reçoit. C'est ce qui permet de le tester avec une
 * horloge figée et un modèle factice, et de composer les agents librement.
 */
export interface AgentContext {
  memory: MemoryEngine;
  llm: LLMProvider;
  embeddings: EmbeddingProvider;
  clock: Clock;
  bus: EventBus;
  logger: Logger;
}

/**
 * Contrat d'agent.
 *
 * Volontairement minimal : un agent prend une entrée, rend une sortie. Toute
 * la richesse vient de la composition, pas d'une hiérarchie de classes. Ajouter
 * un agent « santé » ou « finances » consiste à écrire un fichier, pas à
 * modifier une machinerie.
 */
export interface Agent<Input = void, Output = void> {
  readonly name: string;
  readonly description: string;
  run(input: Input, context: AgentContext, signal?: AbortSignal): Promise<Output>;
}

/** Outil exposé au modèle pendant une conversation. */
export interface AgentTool<I = Record<string, unknown>, O = unknown> {
  name: string;
  description: string;
  /** Libellé affiché dans l'interface pendant l'exécution. */
  label: string;
  inputSchema: Record<string, unknown>;
  run(input: I, context: AgentContext): Promise<O>;
}

/**
 * Registre d'outils. Les modules y déposent leurs capacités au démarrage :
 * c'est ainsi que le module « projets » ajoute la recherche de fichiers sans
 * que l'agent de conversation ait à le connaître.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool<never, unknown>>();

  register<I extends Record<string, unknown>, O>(tool: AgentTool<I, O>): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Outil déjà enregistré : ${tool.name}`);
    }
    this.tools.set(tool.name, tool as unknown as AgentTool<never, unknown>);
    return this;
  }

  get(name: string): AgentTool<never, unknown> | undefined {
    return this.tools.get(name);
  }

  list(): Array<AgentTool<never, unknown>> {
    return [...this.tools.values()];
  }

  /** Schémas au format attendu par le fournisseur de modèle. */
  schemas(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  /**
   * Exécute un outil. Ne lève jamais : une erreur d'outil est rendue au modèle
   * comme un résultat d'erreur, pour qu'il puisse s'adapter au lieu de faire
   * tomber la conversation.
   */
  async execute(
    name: string,
    input: Record<string, unknown>,
    context: AgentContext,
  ): Promise<{ ok: boolean; output: unknown; durationMs: number }> {
    const startedAt = Date.now();
    const tool = this.tools.get(name);

    if (!tool) {
      return {
        ok: false,
        output: `Outil inconnu : ${name}`,
        durationMs: Date.now() - startedAt,
      };
    }

    try {
      const output = await tool.run(input as never, context);
      context.bus.emit({
        kind: 'tool.invoked',
        actor: 'valmont',
        payload: { name, ok: true },
      });
      return { ok: true, output, durationMs: Date.now() - startedAt };
    } catch (error) {
      context.logger.error('outil en échec', { name, error: String(error) });
      context.bus.emit({
        kind: 'tool.invoked',
        actor: 'valmont',
        payload: { name, ok: false, error: String(error) },
      });
      return { ok: false, output: String(error), durationMs: Date.now() - startedAt };
    }
  }
}
