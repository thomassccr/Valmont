import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import type { Logger, ValmontConfig } from '@valmont/kernel';
import type { MemoryEngine } from '@valmont/memory';
import { newId, type ClientMessage, type ServerMessage } from '@valmont/types';
import type { Orchestrator } from './orchestrator.js';

export interface ServerDeps {
  config: ValmontConfig;
  memory: MemoryEngine;
  orchestrator: Orchestrator;
  logger: Logger;
  modules: () => Array<{ name: string; status: string; detail?: string }>;
  version: string;
}

/**
 * Serveur du noyau.
 *
 * REST pour ce qui se lit ponctuellement, WebSocket pour ce qui vit : la
 * conversation en flux, les changements d'état qui pilotent le noyau
 * holographique, et les initiatives que Valmont pousse de lui-même. Un client
 * ne connaît que ce protocole — jamais la base de données.
 *
 * Écoute par défaut sur 127.0.0.1 : la mémoire d'une personne n'a rien à faire
 * sur le réseau. Un jeton partagé protège contre les autres processus locaux.
 */
export async function createServer(deps: ServerDeps) {
  const { config, memory, orchestrator, logger } = deps;

  const app = Fastify({ logger: false, bodyLimit: 8 * 1024 * 1024 });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  const clients = new Set<{ send: (message: ServerMessage) => void }>();

  const broadcast = (message: ServerMessage): void => {
    for (const client of clients) client.send(message);
  };

  // L'état et les initiatives sont poussés à tous les clients connectés :
  // l'interface de bureau et une éventuelle vue mobile restent synchrones.
  orchestrator.onState((state) => broadcast({ type: 'state', state }));
  orchestrator.onInitiative((initiative) => broadcast({ type: 'initiative', initiative }));

  // ── REST ──────────────────────────────────────────────────────────────

  app.get('/health', async () => ({
    ok: true,
    version: deps.version,
    state: orchestrator.getState(),
    modules: deps.modules(),
    memory: memory.stats(),
  }));

  app.get('/dashboard', async (request) => {
    const days = Number((request.query as { days?: string }).days ?? 90);
    return memory.metrics.snapshot(days);
  });

  app.get('/themes', async () => memory.themes.list(20));

  app.get('/entities', async (request) => {
    const query = request.query as { type?: string; status?: string };
    return memory.entities.list({
      ...(query.type ? { type: query.type as never } : {}),
      ...(query.status ? { status: query.status as never } : {}),
      limit: 200,
    });
  });

  app.get('/entities/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const dossier = memory.entities.dossier(id);
    if (!dossier) return reply.code(404).send({ error: 'entité introuvable' });
    return dossier;
  });

  app.post('/memory/search', async (request) => {
    const body = request.body as { text: string; limit?: number; includeOld?: boolean };
    return memory.recall({
      text: body.text,
      limit: body.limit ?? 20,
      ...(body.includeOld ? { includeSuperseded: true } : {}),
    });
  });

  app.get('/sessions', async () => memory.journal.recentSessions(50));

  app.get('/sessions/:id/messages', async (request) => {
    const { id } = request.params as { id: string };
    return memory.journal.messages(id, 200);
  });

  app.get('/initiatives', async () => ({
    pending: memory.initiatives.pending(20),
    recent: memory.initiatives.recent(30),
  }));

  app.post('/initiatives/:id/:outcome', async (request, reply) => {
    const { id, outcome } = request.params as { id: string; outcome: string };
    if (outcome !== 'acted' && outcome !== 'dismissed') {
      return reply.code(400).send({ error: 'issue invalide' });
    }
    orchestrator.resolveInitiative(id, outcome);
    return { ok: true };
  });

  app.get('/profile', async () => ({
    profile: memory.profile.profile(),
    persona: memory.profile.persona(),
    policy: memory.initiatives.getPolicy(),
  }));

  app.post('/profile/persona', async (request) => {
    memory.profile.setPersona(request.body as never);
    return { ok: true, persona: memory.profile.persona() };
  });

  // Déclencheurs manuels des agents de fond — indispensables pour tester
  // sans attendre la nuit.
  app.post('/agents/:name/run', async (request, reply) => {
    const { name } = request.params as { name: string };
    switch (name) {
      case 'observer':
        await orchestrator.observe();
        return { ok: true };
      case 'reflection':
        await orchestrator.reflect();
        return { ok: true };
      case 'maintenance':
        await orchestrator.maintain();
        return { ok: true };
      default:
        return reply.code(404).send({ error: `agent inconnu : ${name}` });
    }
  });

  // ── WebSocket ─────────────────────────────────────────────────────────

  app.get('/ws', { websocket: true }, (socket) => {
    let authenticated = config.server.token.length === 0;
    let sessionId = orchestrator.session('text');

    const send = (message: ServerMessage): void => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    };

    const client = { send };
    clients.add(client);

    const stats = memory.stats();
    send({
      type: 'ready',
      sessionId,
      state: orchestrator.getState(),
      boot: {
        version: deps.version,
        memoryCount: stats.memories,
        entityCount: stats.entities,
        ...(stats.since ? { since: stats.since } : {}),
        modules: deps.modules() as never,
      },
    });

    socket.on('message', (raw: Buffer) => {
      void (async () => {
        let message: ClientMessage;
        try {
          message = JSON.parse(raw.toString()) as ClientMessage;
        } catch {
          return;
        }

        if (message.type === 'hello') {
          authenticated = config.server.token.length === 0 || message.token === config.server.token;
          if (!authenticated) {
            send({ type: 'chat.error', sessionId, error: 'jeton invalide' });
            socket.close();
          }
          return;
        }

        if (!authenticated) return;

        switch (message.type) {
          case 'ping':
            send({ type: 'pong' });
            return;

          case 'chat.send': {
            sessionId = message.sessionId ?? orchestrator.session(message.channel);
            const messageId = newId();

            try {
              const result = await orchestrator.chat(
                { sessionId, text: message.text, channel: message.channel },
                {
                  onDelta: (text) => send({ type: 'chat.delta', sessionId, messageId, text }),
                  onToolStart: (name, label) => send({ type: 'tool.start', name, label }),
                  onToolEnd: (name, ok) => send({ type: 'tool.end', name, ok }),
                },
              );

              send({
                type: 'chat.done',
                sessionId,
                messageId,
                text: result.text,
                context: {
                  memoryIds: result.memoryIds,
                  estimatedTokens: 0,
                  sections: [],
                },
              });

              // Une initiative peut mûrir pendant l'échange ; on regarde
              // juste après, quand Valmont vient de se taire.
              setTimeout(() => orchestrator.deliverPending(), 1500);
            } catch (error) {
              logger.error('tour de conversation en échec', { error: String(error) });
              send({ type: 'chat.error', sessionId, error: String(error) });
            }
            return;
          }

          case 'chat.interrupt':
            orchestrator.interrupt();
            return;

          case 'session.end':
            memory.journal.endSession(message.sessionId);
            sessionId = orchestrator.session('text');
            return;

          case 'state.set':
            // L'interface signale l'écoute micro : le noyau doit réagir avant
            // que le moindre mot soit transcrit.
            orchestrator.setState(message.state);
            return;

          case 'initiative.resolve':
            orchestrator.resolveInitiative(message.id, message.outcome);
            return;

          case 'dashboard.request':
            send({ type: 'dashboard', snapshot: memory.metrics.snapshot(message.days ?? 90) });
            send({ type: 'themes', themes: memory.themes.list(12) });
            return;

          case 'memory.search': {
            const results = await memory.recall({
              text: message.text,
              limit: message.limit ?? 20,
            });
            send({ type: 'memory.results', results });
            return;
          }
        }
      })();
    });

    socket.on('close', () => {
      clients.delete(client);
    });
  });

  return {
    app,
    async listen(): Promise<void> {
      await app.listen({ host: config.server.host, port: config.server.port });
      logger.info('noyau à l’écoute', {
        url: `http://${config.server.host}:${config.server.port}`,
      });
    },
    async close(): Promise<void> {
      await app.close();
    },
  };
}
