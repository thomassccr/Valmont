import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentContext } from '@valmont/agents';
import {
  HOUR,
  MINUTE,
  Scheduler,
  createClock,
  createEventBus,
  createLogger,
  loadConfig,
  loadDotEnv,
} from '@valmont/kernel';
import { createEmbeddingProvider, createLLMProvider } from '@valmont/llm';
import { MemoryEngine } from '@valmont/memory';
import { Orchestrator } from './orchestrator.js';
import { createServer } from './server.js';

const VERSION = '0.1.0';

/**
 * Démarrage du noyau.
 *
 * Ordre imposé par les dépendances : configuration → journalisation → bus →
 * fournisseurs → mémoire → agents → tâches planifiées → serveur. Chaque étage
 * ne connaît que celui d'en dessous.
 *
 * Aucune étape n'est bloquante en cas d'échec d'un service externe : Valmont
 * démarre en mode dégradé et le signale, plutôt que de refuser de s'ouvrir.
 */
async function main(): Promise<void> {
  loadDotEnv(process.cwd());
  const config = loadConfig();

  const logger = createLogger({ level: config.logLevel, dir: config.paths.logs }, 'valmont');
  logger.info('démarrage de Valmont', { version: VERSION, home: config.home });

  // Jeton local, généré une fois et conservé. Il empêche un autre processus de
  // la machine de dialoguer avec la mémoire.
  if (!config.server.token) {
    config.server.token = randomBytes(24).toString('hex');
    const tokenPath = join(config.home, 'token');
    writeFileSync(tokenPath, config.server.token, { mode: 0o600 });
    logger.info('jeton local généré', { path: tokenPath });
  }

  const clock = createClock();
  const bus = createEventBus(logger);

  const llm = createLLMProvider(config);
  const embeddings = createEmbeddingProvider(config);

  const llmHealth = llm.health();
  const embeddingHealth = embeddings.health();
  if (!llmHealth.ok) logger.warn('modèle indisponible', { detail: llmHealth.detail });
  if (!embeddingHealth.ok) logger.warn('embeddings dégradés', { detail: embeddingHealth.detail });

  const memory = new MemoryEngine({ config, embeddings, clock, bus, logger });

  const agentContext: AgentContext = { memory, llm, embeddings, clock, bus, logger };
  const orchestrator = new Orchestrator(agentContext, logger);

  // ── Tâches planifiées ────────────────────────────────────────────────
  const scheduler = new Scheduler(clock, logger.child('scheduler'));

  // Observation régulière : c'est la boucle qui rend Valmont vivant entre deux
  // conversations. 20 minutes suffisent — les signaux qu'il surveille évoluent
  // à l'échelle du jour, pas de la minute.
  scheduler.add({
    name: 'observation',
    every: 20 * MINUTE,
    onStartAfterMs: 90_000,
    run: async () => {
      await orchestrator.observe();
    },
  });

  // Consolidation nocturne : résumés de session puis réflexion. À 3h, quand la
  // machine est libre et que la journée est complète.
  scheduler.add({
    name: 'consolidation',
    dailyAt: '03:00',
    run: async () => {
      await orchestrator.reflect();
    },
  });

  // Entretien : rattrapage des vecteurs, fusion des thèmes, décroissance,
  // oubli. Après la consolidation, pour travailler sur des données à jour.
  scheduler.add({
    name: 'entretien',
    dailyAt: '03:30',
    run: async () => {
      await orchestrator.maintain();
    },
  });

  // Recalcul des thèmes plus fréquent : c'est ce qui alimente le contexte des
  // conversations de la journée.
  scheduler.add({
    name: 'themes',
    every: 6 * HOUR,
    onStartAfterMs: 30_000,
    run: async () => {
      memory.themes.recompute();
    },
  });

  // Sauvegarde quotidienne, en rotation sur sept jours.
  scheduler.add({
    name: 'sauvegarde',
    dailyAt: '04:00',
    run: async () => {
      const day = new Date().getDay();
      await memory.backup(join(config.paths.cache, `valmont-${day}.db`));
    },
  });

  const modules = () => [
    { name: 'mémoire', status: 'ready' as const, detail: `${memory.stats().memories} souvenirs` },
    {
      name: 'modèle',
      status: llmHealth.ok ? ('ready' as const) : ('degraded' as const),
      ...(llmHealth.detail ? { detail: llmHealth.detail } : {}),
    },
    {
      name: 'embeddings',
      status: embeddingHealth.ok
        ? embeddings.name === 'local'
          ? ('degraded' as const)
          : ('ready' as const)
        : ('degraded' as const),
      ...(embeddingHealth.detail ? { detail: embeddingHealth.detail } : {}),
    },
    { name: 'agents', status: 'ready' as const, detail: `${orchestrator.tools.list().length} outils` },
  ];

  const server = await createServer({
    config,
    memory,
    orchestrator,
    logger: logger.child('server'),
    modules,
    version: VERSION,
  });

  await server.listen();

  const stats = memory.stats();
  logger.info('Valmont est prêt', {
    souvenirs: stats.memories,
    entités: stats.entities,
    depuis: stats.since ? new Date(stats.since).toISOString().slice(0, 10) : 'aujourd’hui',
  });

  // ── Arrêt propre ──────────────────────────────────────────────────────
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('arrêt en cours', { signal });

    scheduler.stop();
    await server.close();
    // On attend les traitements de fond : une extraction en cours ne doit
    // jamais être perdue à l'arrêt.
    await bus.drain();
    memory.close();

    logger.info('Valmont arrêté');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error('promesse rejetée non gérée', { reason: String(reason) });
  });
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Échec du démarrage :', error);
  process.exit(1);
});
