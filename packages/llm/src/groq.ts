import { retry } from '@valmont/kernel';
import {
  LLMError,
  type LLMBlock,
  type LLMMessage,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
  type LLMStreamHandlers,
  type LLMToolUseBlock,
} from './types.js';

export interface GroqProviderOptions {
  apiKey?: string;
  model?: string;
  fastModel?: string;
  baseUrl?: string;
}

/** Message au format OpenAI, tel qu'attendu par Groq. */
interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

/**
 * Fournisseur Groq.
 *
 * Groq sert des modèles ouverts sur du matériel dédié : la génération est
 * spectaculairement rapide (souvent 10× Claude) et bien moins chère, avec un
 * palier gratuit généreux. En contrepartie, les modèles disponibles n'ont pas
 * la finesse de Claude sur le raisonnement long et la nuance de ton.
 *
 * D'où l'usage recommandé : **Groq pour le volume, Claude pour la voix**. Les
 * tâches de fond de Valmont — extraction, résumé, classification, reformulation
 * — sont massives en nombre et faibles en exigence ; c'est exactement le
 * terrain de Groq. Voir `RoutedProvider` pour ce découpage.
 *
 * L'API est compatible OpenAI. On l'appelle en HTTP direct plutôt que via un
 * SDK : une seule route est utilisée, et c'est une dépendance de moins dans un
 * projet censé durer.
 *
 * ⚠️ Groq ne propose **pas** d'embeddings. La mémoire vectorielle reste sur
 * Ollama, OpenAI ou le repli local.
 */
export class GroqProvider implements LLMProvider {
  readonly name = 'groq';
  readonly defaultModel: string;
  readonly fastModel: string;

  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;

  constructor(options: GroqProviderOptions = {}) {
    this.apiKey = options.apiKey ?? process.env['GROQ_API_KEY'];
    // Aucun identifiant de modèle n'est codé en dur au-delà de ce défaut :
    // le catalogue de Groq bouge vite, et un modèle retiré ne doit pas exiger
    // une nouvelle version de Valmont. Voir console.groq.com/docs/models.
    this.defaultModel = options.model ?? 'llama-3.3-70b-versatile';
    this.fastModel = options.fastModel ?? this.defaultModel;
    this.baseUrl = options.baseUrl ?? 'https://api.groq.com/openai/v1';
  }

  health(): { ok: boolean; detail?: string } {
    return this.apiKey
      ? { ok: true, detail: this.defaultModel }
      : { ok: false, detail: 'GROQ_API_KEY absente' };
  }

  /**
   * Traduit le format interne vers celui d'OpenAI.
   *
   * Deux écarts à gérer, et ils sont la source classique des bugs :
   *  - il n'y a pas de champ `system` séparé : l'invite système devient le
   *    premier message ;
   *  - un résultat d'outil n'est pas un bloc dans un message utilisateur mais
   *    un **message à part entière** de rôle `tool`. Un seul tour Anthropic
   *    peut donc produire plusieurs messages ici.
   */
  private buildMessages(request: LLMRequest): ChatMessage[] {
    const messages: ChatMessage[] = [];

    if (request.system) {
      const text =
        typeof request.system === 'string'
          ? request.system
          : request.system.map((segment) => segment.text).join('\n\n');
      if (text.trim()) messages.push({ role: 'system', content: text });
    }

    for (const message of request.messages) {
      if (typeof message.content === 'string') {
        messages.push({ role: message.role, content: message.content });
        continue;
      }

      const text = message.content
        .filter((block): block is Extract<LLMBlock, { type: 'text' }> => block.type === 'text')
        .map((block) => block.text)
        .join('\n');

      const toolUses = message.content.filter(
        (block): block is LLMToolUseBlock => block.type === 'tool_use',
      );

      const toolResults = message.content.filter(
        (block): block is Extract<LLMBlock, { type: 'tool_result' }> =>
          block.type === 'tool_result',
      );

      if (toolUses.length > 0) {
        messages.push({
          role: 'assistant',
          content: text || null,
          tool_calls: toolUses.map((use) => ({
            id: use.id,
            type: 'function' as const,
            function: { name: use.name, arguments: JSON.stringify(use.input) },
          })),
        });
      } else if (text.trim() && toolResults.length === 0) {
        messages.push({ role: message.role, content: text });
      }

      // Un message `tool` par résultat, chacun rattaché à son appel.
      for (const result of toolResults) {
        messages.push({
          role: 'tool',
          tool_call_id: result.toolUseId,
          content: result.content,
        });
      }
    }

    return messages;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    return this.stream(request, {});
  }

  async stream(request: LLMRequest, handlers: LLMStreamHandlers): Promise<LLMResponse> {
    const startedAt = Date.now();
    if (!this.apiKey) throw new LLMError('GROQ_API_KEY absente');

    const model = request.model ?? this.defaultModel;
    const body: Record<string, unknown> = {
      model,
      messages: this.buildMessages(request),
      max_tokens: request.maxTokens ?? 8192,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (request.tools?.length) {
      body['tools'] = request.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      }));
    }
    if (request.stopSequences?.length) body['stop'] = request.stopSequences;

    // `effort` n'est volontairement pas transmis : seuls certains modèles Groq
    // acceptent `reasoning_effort`, et l'envoyer aux autres renvoie un 400.
    // La profondeur se règle ici en choisissant le modèle.

    try {
      return await retry(
        async () => {
          const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
            ...(request.signal ? { signal: request.signal } : {}),
          });

          if (!response.ok || !response.body) {
            const detail = await response.text().catch(() => '');
            throw new LLMError(
              `Groq : ${response.status} ${detail.slice(0, 400)}`,
              undefined,
              response.status === 429 || response.status >= 500,
            );
          }

          return this.consume(response.body, handlers, model, startedAt);
        },
        { attempts: 3, ...(request.signal ? { signal: request.signal } : {}) },
      );
    } catch (error) {
      if (request.signal?.aborted) {
        return {
          text: '',
          toolUses: [],
          stopReason: 'aborted',
          usage: { inputTokens: 0, outputTokens: 0 },
          model,
          latencyMs: Date.now() - startedAt,
        };
      }
      throw error instanceof LLMError ? error : new LLMError('appel Groq en échec', error, true);
    }
  }

  /** Consomme le flux SSE et reconstitue texte, appels d'outils et usage. */
  private async consume(
    stream: ReadableStream<Uint8Array>,
    handlers: LLMStreamHandlers,
    model: string,
    startedAt: number,
  ): Promise<LLMResponse> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    let buffer = '';
    let text = '';
    let started = false;
    let stopReason: LLMResponse['stopReason'] = 'end_turn';
    const usage: LLMResponse['usage'] = { inputTokens: 0, outputTokens: 0 };

    // Les arguments d'outil arrivent en fragments de JSON, indexés.
    const partials = new Map<number, { id: string; name: string; args: string }>();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Un événement SSE se termine par une ligne vide ; on ne traite que les
      // événements complets et on garde le reste en tampon.
      const events = buffer.split('\n');
      buffer = events.pop() ?? '';

      for (const line of events) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;

        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;

        let chunk: {
          choices?: Array<{
            delta?: {
              content?: string | null;
              tool_calls?: Array<{
                index: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }>;
            };
            finish_reason?: string | null;
          }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        try {
          chunk = JSON.parse(payload);
        } catch {
          continue; // fragment illisible : on l'ignore plutôt que de tout perdre
        }

        if (chunk.usage) {
          usage.inputTokens = chunk.usage.prompt_tokens ?? usage.inputTokens;
          usage.outputTokens = chunk.usage.completion_tokens ?? usage.outputTokens;
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        const content = choice.delta?.content;
        if (content) {
          if (!started) {
            started = true;
            handlers.onStart?.();
          }
          text += content;
          handlers.onTextDelta?.(content);
        }

        for (const call of choice.delta?.tool_calls ?? []) {
          const partial = partials.get(call.index) ?? { id: '', name: '', args: '' };
          if (call.id) partial.id = call.id;
          if (call.function?.name) partial.name = call.function.name;
          if (call.function?.arguments) partial.args += call.function.arguments;
          partials.set(call.index, partial);
        }

        if (choice.finish_reason) {
          stopReason =
            choice.finish_reason === 'tool_calls'
              ? 'tool_use'
              : choice.finish_reason === 'length'
                ? 'max_tokens'
                : 'end_turn';
        }
      }
    }

    const toolUses: LLMToolUseBlock[] = [...partials.values()]
      .filter((partial) => partial.name)
      .map((partial) => {
        const block: LLMToolUseBlock = {
          type: 'tool_use',
          // Certains modèles omettent l'identifiant : on en fabrique un, sans
          // quoi le message `tool` de réponse ne pourrait pas être rattaché.
          id: partial.id || `call_${partial.name}_${Math.random().toString(36).slice(2, 10)}`,
          name: partial.name,
          input: safeParse(partial.args),
        };
        handlers.onToolUse?.(block);
        return block;
      });

    if (toolUses.length > 0 && stopReason === 'end_turn') stopReason = 'tool_use';

    return { text, toolUses, stopReason, usage, model, latencyMs: Date.now() - startedAt };
  }
}

/** Les arguments peuvent être tronqués si le flux est interrompu. */
function safeParse(json: string): Record<string, unknown> {
  if (!json.trim()) return {};
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}
