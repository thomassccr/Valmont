import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClock, createEventBus, createLogger, loadConfig, DAY } from '@valmont/kernel';
import { LocalEmbeddingProvider } from '@valmont/llm';
import { MemoryEngine } from '@valmont/memory';

const home = mkdtempSync(join(tmpdir(), 'valmont-smoke-'));
process.env['VALMONT_HOME'] = home;

const logger = createLogger({ level: 'warn' });
const bus = createEventBus(logger);
const clock = createClock();
const config = loadConfig();
const engine = new MemoryEngine({
  config,
  embeddings: new LocalEmbeddingProvider({}),
  clock,
  bus,
  logger,
});

const contradictions: unknown[] = [];
bus.on('contradiction.detected', (e) => contradictions.push(e.payload));

// ── Entités ──
const vintex = engine.entities.upsert({ type: 'project', name: 'Vintex', status: 'active' });
const sport = engine.entities.upsert({ type: 'habit', name: 'Sport' });
engine.entities.relate(vintex.id, sport.id, 'competes_with');

// ── Souvenirs ──
await engine.remember({
  kind: 'semantic',
  content: 'Son objectif principal pour 2026 est de faire passer Vintex à 10k de revenus mensuels.',
  claim: { subject: 'objectif_2026', predicate: 'cible', object: '10k MRR' },
  importance: 0.9,
  entityIds: [vintex.id],
});

for (let i = 0; i < 6; i++) {
  await engine.remember({
    kind: 'episodic',
    content: `Séance de sport ce matin, discipline et nutrition suivies (jour ${i}).`,
    occurredAt: clock.now() - i * DAY,
    entityIds: [sport.id],
    importance: 0.5,
  });
}

// Contradiction : même (sujet, prédicat), objet différent
await engine.remember({
  kind: 'semantic',
  content: "Il révise son objectif 2026 : viser 25k de revenus mensuels sur Vintex.",
  claim: { subject: 'objectif_2026', predicate: 'cible', object: '25k MRR' },
  importance: 0.9,
  entityIds: [vintex.id],
});

// Doublon quasi identique
const before = engine.memories.count();
await engine.remember({
  kind: 'episodic',
  content: 'Séance de sport ce matin, discipline et nutrition suivies (jour 0).',
});
const after = engine.memories.count();

// ── Métriques ──
for (let d = 0; d < 30; d++) {
  const at = clock.now() - d * DAY;
  engine.metrics.record({ key: 'sport', value: d % 2 === 0 ? 1 : 0, at, source: 'declared' });
  engine.metrics.record({ key: 'mood', value: d < 7 ? 0.3 : 0.75, at, source: 'inferred' });
  engine.metrics.record({ key: 'work_hours', value: d < 7 ? 3 : 8, at, source: 'observed' });
}

// ── Thèmes ──
engine.themes.recompute();

// ── Initiative ──
const initiative = engine.initiatives.propose({
  kind: 'trend_shift',
  title: 'Tu travailles beaucoup moins cette semaine.',
  rationale: 'work_hours -62% sur 7j, z=-2.1',
  confidence: 0.8,
  priority: 0.7,
  evidence: { metricKeys: ['work_hours'] },
  cooldownKey: 'trend:work_hours',
  cooldownDays: 7,
});

// ── Récupération ──
const recalled = await engine.recall({ text: 'où en est mon objectif de revenus ?', limit: 5 });
const sportRecall = await engine.recall({ text: 'discipline et nutrition', limit: 3 });

// ── Profil ──
for (let i = 0; i < 6; i++) engine.profile.observe('rhythms', 'peak_hours', 'matin');

// ── Journal ──
const session = engine.journal.resumeOrStart('text');
engine.journal.addMessage({ sessionId: session.id, role: 'user', content: 'salut', channel: 'text' });

await engine.maintenance();

console.log(JSON.stringify({
  stats: engine.stats(),
  dedup: { before, after, deduped: before === after },
  contradictions: contradictions.length,
  contradiction: contradictions[0],
  topRecall: recalled.map((r) => ({ c: r.memory.content.slice(0, 60), s: +r.score.toFixed(3) })),
  sportRecall: sportRecall.map((r) => r.memory.content.slice(0, 45)),
  themes: engine.themes.list().map((t) => ({ label: t.label, momentum: +t.momentum.toFixed(2), n: t.mentionCount })),
  trends: engine.metrics.significantTrends().map((t) => ({ k: t.key, d: +t.delta.toFixed(2), z: +t.zScore.toFixed(2), dir: t.direction })),
  correlations: engine.metrics.correlations().map((c) => `${c.a}~${c.b}(lag${c.lagDays}) r=${c.r.toFixed(2)}`),
  streak: engine.metrics.streak('sport'),
  initiative: initiative?.title ?? null,
  deliverable: engine.initiatives.nextDeliverable({ ignoreQuietHours: true })?.title ?? null,
  dossier: (() => { const d = engine.entities.dossier(vintex.id); return { name: d?.entity.name, rel: d?.relations.length, mem: d?.recentMemories.length, dormant: d?.daysSinceLastMention }; })(),
  profile: engine.profile.section('rhythms'),
  session: { messages: engine.journal.messages(session.id).length },
}, null, 2));

engine.close();
