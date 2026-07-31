import type { InitiativeId, MessageId, SessionId } from './ids.js';
import type { AffectSnapshot, ContextBundle, ValmontState } from './conversation.js';
import type { Initiative } from './initiative.js';
import type { ScoredMemory, Theme } from './memory.js';
import type { DashboardSnapshot } from './metrics.js';

/**
 * Protocole temps réel entre le noyau et les clients (bureau, web, mobile).
 *
 * Volontairement transport-agnostique : aujourd'hui WebSocket, demain
 * peut-être IPC natif ou WebTransport. Les clients ne connaissent que ces
 * messages, jamais la base de données.
 */

export type ClientMessage =
  | { type: 'hello'; token: string; client: string; version: string }
  | { type: 'chat.send'; sessionId?: SessionId; text: string; channel: 'text' | 'voice' }
  | { type: 'chat.interrupt'; sessionId: SessionId }
  | { type: 'session.end'; sessionId: SessionId }
  | { type: 'state.set'; state: ValmontState }
  | { type: 'initiative.resolve'; id: InitiativeId; outcome: 'acted' | 'dismissed' }
  | { type: 'dashboard.request'; days?: number }
  | { type: 'memory.search'; text: string; limit?: number }
  | { type: 'ping' };

export type ServerMessage =
  | { type: 'ready'; sessionId: SessionId; state: ValmontState; boot: BootInfo }
  | { type: 'state'; state: ValmontState }
  /** Fragment de réponse en flux — pilote aussi l'animation de parole. */
  | { type: 'chat.delta'; sessionId: SessionId; messageId: MessageId; text: string }
  | {
      type: 'chat.done';
      sessionId: SessionId;
      messageId: MessageId;
      text: string;
      context: ContextBundle;
    }
  | { type: 'chat.error'; sessionId: SessionId; error: string }
  /** Valmont utilise un outil : l'interface peut montrer l'activité interne. */
  | { type: 'tool.start'; name: string; label: string }
  | { type: 'tool.end'; name: string; ok: boolean; summary?: string }
  | { type: 'initiative'; initiative: Initiative }
  | { type: 'dashboard'; snapshot: DashboardSnapshot }
  | { type: 'memory.results'; results: ScoredMemory[] }
  | { type: 'affect'; affect: AffectSnapshot }
  | { type: 'themes'; themes: Theme[] }
  | { type: 'pong' };

export interface BootInfo {
  version: string;
  /** Nombre de souvenirs actifs — Valmont affiche « X souvenirs » au réveil. */
  memoryCount: number;
  entityCount: number;
  /** Date du premier souvenir : depuis quand Valmont accompagne l'utilisateur. */
  since?: number;
  /** Modules chargés et opérationnels. */
  modules: Array<{ name: string; status: 'ready' | 'degraded' | 'off'; detail?: string }>;
}
