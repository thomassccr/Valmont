'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BootInfo,
  ClientMessage,
  DashboardSnapshot,
  Initiative,
  ServerMessage,
  Theme,
  ValmontState,
} from '@valmont/types';

export interface Turn {
  id: string;
  role: 'user' | 'valmont';
  text: string;
  streaming?: boolean;
  /** Initiative dont ce tour est issu — Valmont a pris la parole seul. */
  spontaneous?: boolean;
  initiativeId?: string;
}

export interface ToolActivity {
  name: string;
  label: string;
}

const CORE_URL = process.env['NEXT_PUBLIC_VALMONT_CORE'] ?? 'ws://127.0.0.1:4319/ws';
const TOKEN = process.env['NEXT_PUBLIC_VALMONT_TOKEN'] ?? '';

/**
 * Connexion au noyau.
 *
 * Le client est volontairement mince : il ne détient aucune logique métier,
 * ne stocke rien en local, et se reconnecte tout seul. Toute la mémoire vit
 * dans le noyau — une interface qui garderait son propre état finirait par
 * diverger, et c'est exactement ce qu'on ne veut pas d'une mémoire.
 */
export function useValmont() {
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<ValmontState>('dormant');
  const [boot, setBoot] = useState<BootInfo | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [tool, setTool] = useState<ToolActivity | null>(null);
  const [dashboard, setDashboard] = useState<DashboardSnapshot | null>(null);
  const [themes, setThemes] = useState<Theme[]>([]);

  const socketRef = useRef<WebSocket | null>(null);
  const sessionRef = useRef<string | null>(null);
  const retryRef = useRef(0);
  const closedRef = useRef(false);

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }, []);

  useEffect(() => {
    closedRef.current = false;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connect = (): void => {
      if (closedRef.current) return;

      const socket = new WebSocket(CORE_URL);
      socketRef.current = socket;

      socket.onopen = () => {
        retryRef.current = 0;
        setConnected(true);
        send({ type: 'hello', token: TOKEN, client: 'desktop', version: '0.1.0' });
      };

      socket.onmessage = (event: MessageEvent<string>) => {
        const message = JSON.parse(event.data) as ServerMessage;

        switch (message.type) {
          case 'ready':
            sessionRef.current = message.sessionId;
            setBoot(message.boot);
            setState(message.state);
            send({ type: 'dashboard.request' });
            break;

          case 'state':
            setState(message.state);
            break;

          case 'chat.delta':
            setTurns((previous) => {
              const last = previous.at(-1);
              if (last?.id === message.messageId) {
                return [...previous.slice(0, -1), { ...last, text: last.text + message.text }];
              }
              return [
                ...previous,
                { id: message.messageId, role: 'valmont', text: message.text, streaming: true },
              ];
            });
            break;

          case 'chat.done':
            setTool(null);
            setTurns((previous) => {
              const last = previous.at(-1);
              if (last?.id === message.messageId) {
                return [...previous.slice(0, -1), { ...last, text: message.text, streaming: false }];
              }
              return [...previous, { id: message.messageId, role: 'valmont', text: message.text }];
            });
            break;

          case 'chat.error':
            setTool(null);
            setTurns((previous) => [
              ...previous,
              { id: `err-${Date.now()}`, role: 'valmont', text: `— ${message.error}` },
            ]);
            break;

          case 'tool.start':
            setTool({ name: message.name, label: message.label });
            break;

          case 'tool.end':
            setTool(null);
            break;

          case 'initiative':
            // Valmont prend la parole de lui-même : le tour est marqué comme
            // spontané pour que l'interface le distingue d'une réponse.
            setTurns((previous) => [
              ...previous,
              {
                id: message.initiative.id,
                role: 'valmont',
                text: message.initiative.title,
                spontaneous: true,
                initiativeId: message.initiative.id,
              },
            ]);
            break;

          case 'dashboard':
            setDashboard(message.snapshot);
            break;

          case 'themes':
            setThemes(message.themes);
            break;
        }
      };

      socket.onclose = () => {
        setConnected(false);
        setState('dormant');
        if (closedRef.current) return;
        // Repli exponentiel plafonné : le noyau peut redémarrer, l'interface
        // doit le retrouver sans qu'on ait à recharger la page.
        const delay = Math.min(10_000, 500 * 2 ** retryRef.current++);
        reconnectTimer = setTimeout(connect, delay);
      };

      socket.onerror = () => socket.close();
    };

    connect();

    return () => {
      closedRef.current = true;
      clearTimeout(reconnectTimer);
      socketRef.current?.close();
    };
  }, [send]);

  const say = useCallback(
    (text: string, channel: 'text' | 'voice' = 'text') => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setTurns((previous) => [
        ...previous,
        { id: `u-${Date.now()}`, role: 'user', text: trimmed },
      ]);
      send({
        type: 'chat.send',
        ...(sessionRef.current ? { sessionId: sessionRef.current } : {}),
        text: trimmed,
        channel,
      });
    },
    [send],
  );

  const interrupt = useCallback(() => {
    if (sessionRef.current) send({ type: 'chat.interrupt', sessionId: sessionRef.current });
  }, [send]);

  /** Signale l'écoute micro au noyau : le noyau visuel réagit immédiatement. */
  const setListening = useCallback(
    (listening: boolean) => {
      send({ type: 'state.set', state: listening ? 'listening' : 'idle' });
    },
    [send],
  );

  const resolveInitiative = useCallback(
    (id: string, outcome: 'acted' | 'dismissed') => {
      send({ type: 'initiative.resolve', id, outcome });
    },
    [send],
  );

  const refreshDashboard = useCallback(
    (days = 90) => send({ type: 'dashboard.request', days }),
    [send],
  );

  return {
    connected,
    state,
    boot,
    turns,
    tool,
    dashboard,
    themes,
    say,
    interrupt,
    setListening,
    resolveInitiative,
    refreshDashboard,
  };
}
