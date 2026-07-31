import Anthropic from '@anthropic-ai/sdk';
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

export interface AnthropicProviderOptions {
  apiKey?: string;
  /** Modèle de conversation — c'est la voix de Valmont, on ne lésine pas. */
  model?: string;
  /** Modèle des tâches de fond (extraction, résumés, classification). */
  fastModel?: string;
  maxRetries?: number;
}

/**
 * Fournisseur Claude.
 *
 * Trois choix structurants ici :
 *
 * 1. **Mise en cache d'invite systématique.** L'invite de Valmont contient la
 *    persona, le profil appris et les souvenirs consolidés : des dizaines de
 *    milliers de jetons quasi identiques d'un tour à l'autre. Le cache les
 *    facture ~0,1× en lecture. Sans lui, une conversation longue coûterait
 *    dix fois plus cher pour un résultat identique.
 *
 * 2. **Aucun paramètre d'échantillonnage.** Les modèles récents rejettent
 *    `temperature` / `top_p`. Le levier est `output_config.effort`, qui règle
 *    à la fois la profondeur de réflexion et la dépense.
 *
 * 3. **Diffusion par défaut.** L'interface a besoin des fragments dès qu'ils
 *    arrivent (le noyau holographique passe de « pense » à « parle » sur le
 *    premier jeton), et le flux évite les délais d'expiration HTTP sur les
 *    réponses longues.
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  readonly defaultModel: string;
  readonly fastModel: string;

  private readonly client: Anthropic;
  private readonly configured: boolean;

  constructor(options: AnthropicProviderOptions = {}) {
    this.defaultModel = options.model ?? 'claude-opus-5';
    this.fastModel = options.fastModel ?? 'claude-sonnet-5';
    this.configured = Boolean(options.apiKey ?? process.env['ANTHROPIC_API_KEY']);
    this.client = new Anthropic({
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      maxRetries: options.maxRetries ?? 2,
    });
  }

  health(): { ok: boolean; detail?: string } {
    return this.configured
      ? { ok: true, detail: this.defaultModel }
      : { ok: false, detail: 'ANTHROPIC_API_KEY absente' };
  }

  /** Convertit l'invite système, en posant les points de cache au bon endroit. */
  private buildSystem(system: LLMRequest['system']): Anthropic.TextBlockParam[] | undefined {
    if (!system) return undefined;
    if (typeof system === 'string') {
      return [{ type: 'text', text: system }];
    }
    return system
      .filter((segment) => segment.text.trim().length > 0)
      .map((segment) => ({
        type: 'text' as const,
        text: segment.text,
        ...(segment.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
      }));
  }

  private buildMessages(messages: LLMMessage[]): Anthropic.MessageParam[] {
    return messages.map((message) => ({
      role: message.role,
      content:
        typeof message.content === 'string'
          ? message.content
          : message.content.map((block) => toSdkBlock(block)),
    }));
  }

  private buildParams(request: LLMRequest): Anthropic.MessageCreateParamsStreaming {
    const params = {
      model: request.model ?? this.defaultModel,
      max_tokens: request.maxTokens ?? 8192,
      messages: this.buildMessages(request.messages),
      stream: true as const,
    } as Anthropic.MessageCreateParamsStreaming & Record<string, unknown>;

    const system = this.buildSystem(request.system);
    if (system && system.length > 0) params.system = system;

    if (request.tools && request.tools.length > 0) {
      params.tools = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
      }));
    }

    if (request.stopSequences?.length) params.stop_sequences = request.stopSequences;
    // `effort` pilote la profondeur ; la réflexion adaptative est active par défaut.
    if (request.effort) params['output_config'] = { effort: request.effort };

    return params;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    return this.stream(request, {});
  }

  async stream(request: LLMRequest, handlers: LLMStreamHandlers): Promise<LLMResponse> {
    const startedAt = Date.now();
    const params = this.buildParams(request);

    try {
      return await retry(
        async () => {
          const stream = await this.client.messages.create(params, {
            ...(request.signal ? { signal: request.signal } : {}),
          });

          let text = '';
          const toolUses: LLMToolUseBlock[] = [];
          // Accumulateurs indexés : le JSON des outils arrive par fragments.
          const partials = new Map<number, { id: string; name: string; json: string }>();
          let started = false;
          let stopReason: LLMResponse['stopReason'] = 'end_turn';
          const usage: LLMResponse['usage'] = { inputTokens: 0, outputTokens: 0 };
          let model = params.model;

          for await (const event of stream) {
            switch (event.type) {
              case 'message_start': {
                model = event.message.model;
                usage.inputTokens = event.message.usage.input_tokens;
                usage.cacheReadTokens = event.message.usage.cache_read_input_tokens ?? 0;
                usage.cacheWriteTokens = event.message.usage.cache_creation_input_tokens ?? 0;
                break;
              }
              case 'content_block_start': {
                if (event.content_block.type === 'tool_use') {
                  partials.set(event.index, {
                    id: event.content_block.id,
                    name: event.content_block.name,
                    json: '',
                  });
                }
                break;
              }
              case 'content_block_delta': {
                if (event.delta.type === 'text_delta') {
                  if (!started) {
                    started = true;
                    handlers.onStart?.();
                  }
                  text += event.delta.text;
                  handlers.onTextDelta?.(event.delta.text);
                } else if (event.delta.type === 'input_json_delta') {
                  const partial = partials.get(event.index);
                  if (partial) partial.json += event.delta.partial_json;
                }
                break;
              }
              case 'content_block_stop': {
                const partial = partials.get(event.index);
                if (partial) {
                  const block: LLMToolUseBlock = {
                    type: 'tool_use',
                    id: partial.id,
                    name: partial.name,
                    input: safeParse(partial.json),
                  };
                  toolUses.push(block);
                  handlers.onToolUse?.(block);
                  partials.delete(event.index);
                }
                break;
              }
              case 'message_delta': {
                usage.outputTokens = event.usage.output_tokens;
                stopReason = mapStopReason(event.delta.stop_reason);
                break;
              }
              default:
                break;
            }
          }

          return {
            text,
            toolUses,
            stopReason,
            usage,
            model,
            latencyMs: Date.now() - startedAt,
          } satisfies LLMResponse;
        },
        { attempts: 3, signal: request.signal },
      );
    } catch (error) {
      if (request.signal?.aborted) {
        return {
          text: '',
          toolUses: [],
          stopReason: 'aborted',
          usage: { inputTokens: 0, outputTokens: 0 },
          model: params.model,
          latencyMs: Date.now() - startedAt,
        };
      }
      throw new LLMError('appel au modèle en échec', error, isRetryable(error));
    }
  }
}

function toSdkBlock(block: LLMBlock): Anthropic.ContentBlockParam {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'tool_use':
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: block.toolUseId,
        content: block.content,
        ...(block.isError ? { is_error: true } : {}),
      };
  }
}

function mapStopReason(reason: string | null | undefined): LLMResponse['stopReason'] {
  switch (reason) {
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'stop_sequence':
      return 'stop_sequence';
    case 'refusal':
      return 'error';
    default:
      return 'end_turn';
  }
}

/** Le JSON d'un outil peut être tronqué si le flux est interrompu. */
function safeParse(json: string): Record<string, unknown> {
  if (!json.trim()) return {};
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function isRetryable(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  return status === undefined || status === 429 || status >= 500;
}
