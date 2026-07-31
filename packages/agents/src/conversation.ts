import type { LLMMessage, LLMRequest } from '@valmont/llm';
import type { ContextBundle, Message, SessionId, ToolCall, ValmontState } from '@valmont/types';
import { ContextAssembler } from './context.js';
import type { Agent, AgentContext, ToolRegistry } from './kernel.js';

export interface ConversationInput {
  sessionId: SessionId;
  text: string;
  channel: 'text' | 'voice';
}

export interface ConversationOutput {
  message: Message;
  context: ContextBundle;
  toolCalls: ToolCall[];
}

export interface ConversationHandlers {
  onDelta?: (text: string) => void;
  onState?: (state: ValmontState) => void;
  onToolStart?: (name: string, label: string) => void;
  onToolEnd?: (name: string, ok: boolean) => void;
}

/** Nombre maximum d'allers-retours d'outils sur un tour. */
const MAX_TOOL_ROUNDS = 6;

/**
 * L'agent de conversation : la voix de Valmont.
 *
 * Il fait trois choses et rien d'autre — assembler le contexte, dialoguer avec
 * le modèle, exécuter les outils demandés. Il n'extrait rien, ne déduit rien,
 * n'écrit aucun souvenir de lui-même : cela appartient aux agents de fond, qui
 * tournent après coup. Cette séparation est ce qui garde la conversation
 * rapide — l'utilisateur n'attend jamais qu'un traitement de mémoire se termine.
 */
export class ConversationAgent implements Agent<ConversationInput, ConversationOutput> {
  readonly name = 'conversation';
  readonly description = 'Dialogue avec la personne, en s’appuyant sur toute sa mémoire.';

  constructor(private readonly tools: ToolRegistry) {}

  async run(
    input: ConversationInput,
    context: AgentContext,
    signal?: AbortSignal,
  ): Promise<ConversationOutput> {
    const { memory } = context;

    // L'échange est journalisé avant l'appel au modèle : si la génération
    // échoue ou est interrompue, ce que la personne a dit n'est jamais perdu.
    memory.journal.addMessage({
      sessionId: input.sessionId,
      role: 'user',
      content: input.text,
      channel: input.channel,
    });
    context.bus.emit({
      kind: 'message.received',
      actor: 'user',
      traceId: input.sessionId,
      payload: { text: input.text, channel: input.channel },
    });

    const assembler = new ContextAssembler(context);
    const { system, bundle } = await assembler.build(input.text, { sessionId: input.sessionId });

    const history = this.buildHistory(context, input.sessionId);
    const messages: LLMMessage[] = [...history, { role: 'user', content: input.text }];

    const toolCalls: ToolCall[] = [];
    let finalText = '';

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const request: LLMRequest = {
        system,
        messages,
        tools: this.tools.schemas(),
        maxTokens: 4096,
        effort: 'medium',
        ...(signal ? { signal } : {}),
      };

      const handlers = this.streamHandlers(context, round);
      const response = await context.llm.stream(request, handlers);

      if (response.stopReason === 'aborted') break;
      if (response.text) finalText = response.text;

      if (response.toolUses.length === 0) break;

      // Le modèle veut des outils : on renvoie son tour tel quel, puis les
      // résultats. Les blocs doivent être conservés à l'identique.
      messages.push({
        role: 'assistant',
        content: [
          ...(response.text ? [{ type: 'text' as const, text: response.text }] : []),
          ...response.toolUses,
        ],
      });

      const results = [];
      for (const use of response.toolUses) {
        const tool = this.tools.get(use.name);
        this.currentHandlers?.onToolStart?.(use.name, tool?.label ?? use.name);
        this.currentHandlers?.onState?.('working');

        const outcome = await this.tools.execute(use.name, use.input, context);

        this.currentHandlers?.onToolEnd?.(use.name, outcome.ok);
        toolCalls.push({
          id: use.id,
          name: use.name,
          input: use.input,
          output: outcome.output,
          durationMs: outcome.durationMs,
          ...(outcome.ok ? {} : { error: String(outcome.output) }),
        });

        results.push({
          type: 'tool_result' as const,
          toolUseId: use.id,
          content: JSON.stringify(outcome.output),
          ...(outcome.ok ? {} : { isError: true }),
        });
      }

      // Tous les résultats dans un seul message : les répartir sur plusieurs
      // apprend au modèle à cesser de paralléliser ses appels d'outils.
      messages.push({ role: 'user', content: results });
      this.currentHandlers?.onState?.('thinking');
    }

    const message = memory.journal.addMessage({
      sessionId: input.sessionId,
      role: 'valmont',
      content: finalText,
      channel: input.channel,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      citedMemoryIds: bundle.memoryIds,
    });

    context.bus.emit({
      kind: 'message.sent',
      actor: 'valmont',
      traceId: input.sessionId,
      payload: { text: finalText, memoryIds: bundle.memoryIds, tools: toolCalls.length },
    });

    return { message, context: bundle, toolCalls };
  }

  private currentHandlers: ConversationHandlers | undefined;

  /** Permet au serveur de brancher le flux sans passer par l'entrée de `run`. */
  withHandlers(handlers: ConversationHandlers): this {
    this.currentHandlers = handlers;
    return this;
  }

  private streamHandlers(context: AgentContext, round: number) {
    return {
      onStart: () => {
        // Premier jeton du premier tour : Valmont passe de « réfléchit » à
        // « parle ». C'est ce signal qui pilote la bascule visuelle du noyau.
        if (round === 0) this.currentHandlers?.onState?.('speaking');
      },
      onTextDelta: (delta: string) => {
        this.currentHandlers?.onDelta?.(delta);
      },
    };
  }

  /**
   * Historique récent de la session. Volontairement court : la continuité vient
   * de la mémoire long terme, pas d'un historique gonflé. Empiler cinquante
   * tours coûterait cher et n'apporterait rien qu'un souvenir bien récupéré
   * n'apporte déjà.
   */
  private buildHistory(context: AgentContext, sessionId: SessionId): LLMMessage[] {
    return context.memory.journal
      .messages(sessionId, 16)
      .filter((message) => message.role === 'user' || message.role === 'valmont')
      .filter((message) => message.content.trim().length > 0)
      .slice(0, -1) // le message courant est ajouté séparément
      .map((message) => ({
        role: message.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: message.content,
      }));
  }
}
