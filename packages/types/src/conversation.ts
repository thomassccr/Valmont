import type { MemoryId, MessageId, SessionId, Timestamp } from './ids.js';

export type Channel = 'text' | 'voice' | 'system';

export type Role = 'user' | 'valmont' | 'system' | 'tool';

export interface Message {
  id: MessageId;
  sessionId: SessionId;
  role: Role;
  content: string;
  createdAt: Timestamp;
  channel: Channel;
  /** Appels d'outils émis par Valmont sur ce tour. */
  toolCalls?: ToolCall[];
  /** Souvenirs qui ont servi à composer la réponse — traçabilité. */
  citedMemoryIds?: MemoryId[];
  meta?: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  durationMs?: number;
}

export interface Session {
  id: SessionId;
  startedAt: Timestamp;
  endedAt?: Timestamp;
  channel: Channel;
  title?: string;
  /** Résumé consolidé, écrit à la clôture de la session. */
  summary?: string;
  messageCount: number;
  /** Lecture émotionnelle de la session, -1 → +1. */
  mood?: number;
  motivation?: number;
  energy?: number;
}

/** État affectif/cognitif courant, dérivé des dernières sessions. */
export interface AffectSnapshot {
  mood: number;
  motivation: number;
  energy: number;
  /** Confiance dans cette lecture (peu de signal récent → faible). */
  confidence: number;
  at: Timestamp;
}

/**
 * L'état de Valmont, tel que l'interface doit le représenter.
 * Le noyau holographique est piloté par cette machine à états.
 */
export type ValmontState =
  | 'dormant'
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'working';

export interface ContextBundle {
  /** Souvenirs injectés dans l'invite, ordonnés par pertinence. */
  memoryIds: MemoryId[];
  /** Nombre de jetons estimés — sert au budget de contexte. */
  estimatedTokens: number;
  /** Sections effectivement montées (profil, thèmes, projets actifs…). */
  sections: string[];
}
