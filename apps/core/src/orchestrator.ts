import {
  ConversationAgent,
  ExtractorAgent,
  ObserverAgent,
  ReflectionAgent,
  SummarizerAgent,
  createCoreTools,
  type AgentContext,
  type ConversationHandlers,
  type ToolRegistry,
} from '@valmont/agents';
import type { Logger } from '@valmont/kernel';
import type { Channel, Initiative, SessionId, ValmontState } from '@valmont/types';

/**
 * Orchestrateur.
 *
 * Il tient l'état vivant de Valmont et coordonne les agents. Deux principes :
 *
 *  1. **Le premier plan ne bloque jamais.** La conversation répond, puis les
 *     agents de fond travaillent. L'extraction d'un tour tourne pendant que la
 *     personne lit la réponse.
 *
 *  2. **Un seul tour à la fois.** Un nouveau message interrompt le précédent
 *     plutôt que de s'empiler — c'est ce qui permet de couper Valmont en
 *     pleine phrase, comme on coupe quelqu'un qui parle.
 */
export class Orchestrator {
  private readonly conversation: ConversationAgent;
  private readonly extractor = new ExtractorAgent();
  private readonly observer = new ObserverAgent();
  private readonly reflection = new ReflectionAgent();
  private readonly summarizer = new SummarizerAgent();

  readonly tools: ToolRegistry;

  private state: ValmontState = 'idle';
  private currentTurn: AbortController | null = null;
  private readonly stateListeners = new Set<(state: ValmontState) => void>();
  private readonly initiativeListeners = new Set<(initiative: Initiative) => void>();

  constructor(
    private readonly context: AgentContext,
    private readonly logger: Logger,
  ) {
    this.tools = createCoreTools();
    this.conversation = new ConversationAgent(this.tools);
  }

  // ── État ──────────────────────────────────────────────────────────────

  getState(): ValmontState {
    return this.state;
  }

  setState(state: ValmontState): void {
    if (this.state === state) return;
    this.state = state;
    for (const listener of this.stateListeners) listener(state);
  }

  onState(listener: (state: ValmontState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onInitiative(listener: (initiative: Initiative) => void): () => void {
    this.initiativeListeners.add(listener);
    return () => this.initiativeListeners.delete(listener);
  }

  // ── Conversation ──────────────────────────────────────────────────────

  session(channel: Channel): SessionId {
    return this.context.memory.journal.resumeOrStart(channel).id;
  }

  /** Coupe le tour en cours. C'est l'interruption en pleine parole. */
  interrupt(): void {
    this.currentTurn?.abort();
    this.currentTurn = null;
    this.setState('idle');
  }

  async chat(
    input: { sessionId: SessionId; text: string; channel: 'text' | 'voice' },
    handlers: ConversationHandlers,
  ): Promise<{ text: string; memoryIds: string[] }> {
    this.interrupt();

    const controller = new AbortController();
    this.currentTurn = controller;
    this.setState('thinking');

    try {
      const result = await this.conversation.withHandlers({
        ...handlers,
        onState: (state) => {
          this.setState(state);
          handlers.onState?.(state);
        },
      }).run(input, this.context, controller.signal);

      this.setState('idle');

      // Extraction en tâche de fond : la personne ne l'attend jamais.
      void this.extractInBackground(input, result.message.content);

      return { text: result.message.content, memoryIds: result.context.memoryIds };
    } catch (error) {
      this.setState('idle');
      throw error;
    } finally {
      if (this.currentTurn === controller) this.currentTurn = null;
    }
  }

  private async extractInBackground(
    input: { sessionId: SessionId; text: string },
    valmontText: string,
  ): Promise<void> {
    try {
      await this.extractor.run(
        { sessionId: input.sessionId, userText: input.text, valmontText },
        this.context,
      );
    } catch (error) {
      // Une extraction ratée ne doit jamais remonter à l'utilisateur : le
      // message brut reste au journal et sera réexploitable plus tard.
      this.logger.error('extraction de fond en échec', { error: String(error) });
    }
  }

  // ── Agents de fond ────────────────────────────────────────────────────

  async observe(): Promise<void> {
    await this.observer.run(undefined, this.context);
    this.deliverPending();
  }

  async reflect(): Promise<void> {
    await this.summarizer.run(undefined, this.context);
    await this.reflection.run({}, this.context);
  }

  async maintain(): Promise<void> {
    await this.context.memory.maintenance();
  }

  /**
   * Livre une initiative si le moment le permet. Toutes les règles
   * d'étiquette vivent dans `InitiativeStore` — ici on ne fait que pousser.
   */
  deliverPending(): void {
    // On ne coupe jamais la parole à l'utilisateur pour une initiative.
    if (this.state !== 'idle') return;

    const initiative = this.context.memory.initiatives.nextDeliverable();
    if (!initiative) return;

    this.context.memory.initiatives.markDelivered(initiative.id);
    for (const listener of this.initiativeListeners) listener(initiative);
    this.logger.info('initiative livrée', { kind: initiative.kind, title: initiative.title });
  }

  resolveInitiative(id: string, outcome: 'acted' | 'dismissed'): void {
    this.context.memory.initiatives.resolve(id, outcome);
  }
}
