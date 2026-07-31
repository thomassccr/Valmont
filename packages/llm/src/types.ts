/**
 * Frontière avec les modèles. Rien au-dessus de cette couche ne connaît
 * Anthropic, OpenAI ou Ollama : changer de fournisseur (ou passer en local)
 * ne doit toucher qu'un fichier de ce dossier.
 */

export type LLMRole = 'user' | 'assistant';

export interface LLMTextBlock {
  type: 'text';
  text: string;
}

export interface LLMToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LLMToolResultBlock {
  type: 'tool_result';
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export type LLMBlock = LLMTextBlock | LLMToolUseBlock | LLMToolResultBlock;

export interface LLMMessage {
  role: LLMRole;
  content: string | LLMBlock[];
}

export interface LLMToolSchema {
  name: string;
  description: string;
  /** JSON Schema de l'entrée. */
  inputSchema: Record<string, unknown>;
}

/**
 * Profondeur de raisonnement. Remplace l'ancien réglage de température :
 * les modèles récents rejettent `temperature` / `top_p`, et l'effort est de
 * toute façon le bon levier (il arbitre réflexion *et* dépense de jetons).
 */
export type LLMEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface LLMRequest {
  /**
   * L'invite système peut être découpée en segments : les segments marqués
   * `cache: true` (persona, profil, souvenirs stables) sont mis en cache côté
   * fournisseur, ce qui divise le coût et la latence sur des contextes longs.
   */
  system?: Array<{ text: string; cache?: boolean }> | string;
  messages: LLMMessage[];
  tools?: LLMToolSchema[];
  maxTokens?: number;
  effort?: LLMEffort;
  /** Force un modèle différent de celui par défaut (tâches rapides). */
  model?: string;
  stopSequences?: string[];
  signal?: AbortSignal;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface LLMResponse {
  text: string;
  toolUses: LLMToolUseBlock[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'aborted' | 'error';
  usage: LLMUsage;
  model: string;
  latencyMs: number;
}

export interface LLMStreamHandlers {
  onTextDelta?: (delta: string) => void;
  onToolUse?: (block: LLMToolUseBlock) => void;
  /** Le modèle a commencé à produire — utile pour l'animation « pense → parle ». */
  onStart?: () => void;
}

export interface LLMProvider {
  readonly name: string;
  readonly defaultModel: string;
  readonly fastModel: string;
  complete(request: LLMRequest): Promise<LLMResponse>;
  stream(request: LLMRequest, handlers: LLMStreamHandlers): Promise<LLMResponse>;
  /** État du fournisseur — remonté au démarrage. */
  health(): { ok: boolean; detail?: string };
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  /** Vectorise un lot. Les vecteurs renvoyés sont **normalisés**. */
  embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]>;
  health(): { ok: boolean; detail?: string };
}

export class LLMError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'LLMError';
  }
}
