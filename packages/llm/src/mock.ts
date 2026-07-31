import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMStreamHandlers,
} from './types.js';

/**
 * Fournisseur factice. Deux usages réels :
 *  - les tests (déterministe, sans réseau, sans coût) ;
 *  - le mode dégradé : si la clé API manque, Valmont démarre quand même et
 *    le dit, plutôt que de refuser de se lancer. Un assistant personnel doit
 *    toujours ouvrir.
 */
export class MockProvider implements LLMProvider {
  readonly name = 'mock';
  readonly defaultModel = 'mock';
  readonly fastModel = 'mock';

  constructor(private readonly responder?: (request: LLMRequest) => string) {}

  health(): { ok: boolean; detail?: string } {
    return { ok: true, detail: 'fournisseur factice — aucune intelligence réelle' };
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    return this.stream(request, {});
  }

  async stream(request: LLMRequest, handlers: LLMStreamHandlers): Promise<LLMResponse> {
    const last = request.messages.at(-1);
    const lastText =
      typeof last?.content === 'string'
        ? last.content
        : (last?.content ?? [])
            .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
            .map((block) => block.text)
            .join(' ');

    const text =
      this.responder?.(request) ??
      `[mode dégradé] Aucune clé API configurée, je ne peux pas réfléchir. Tu disais : « ${lastText.slice(0, 120)} »`;

    handlers.onStart?.();
    for (const chunk of text.match(/.{1,12}/g) ?? []) {
      handlers.onTextDelta?.(chunk);
      await new Promise((resolve) => setTimeout(resolve, 8));
    }

    return {
      text,
      toolUses: [],
      stopReason: 'end_turn',
      usage: { inputTokens: 0, outputTokens: 0 },
      model: 'mock',
      latencyMs: 0,
    };
  }
}
