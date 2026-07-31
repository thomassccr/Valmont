import { DAY, timeAgo, truncate } from '@valmont/kernel';
import type { EntityStatus, EntityType, MemoryKind, MetricKey } from '@valmont/types';
import type { AgentTool } from './kernel.js';
import { ToolRegistry } from './kernel.js';

/**
 * Outils du noyau.
 *
 * Principe de conception : peu d'outils, larges. Une vingtaine d'outils
 * étroits noient le modèle et font chuter la précision du choix ; sept outils
 * bien décrits couvrent le même terrain. Chaque description dit **quand**
 * appeler l'outil, pas seulement ce qu'il fait — c'est ce qui fait la
 * différence sur le taux de déclenchement.
 */

const searchMemory: AgentTool<
  { query: string; kind?: MemoryKind; days?: number; includeOld?: boolean },
  unknown
> = {
  name: 'chercher_memoire',
  label: 'Fouille sa mémoire',
  description:
    "Cherche dans la mémoire long terme. Appelle-le dès qu'une question porte sur son passé, " +
    "ses projets, ses décisions, ses idées ou ses habitudes — y compris quand tu crois savoir : " +
    "ta mémoire de travail ne contient qu'une fraction de ce qui est stocké. " +
    "Mets `includeOld` à vrai pour les questions rétrospectives (« qu'est-ce que je pensais avant ? »), " +
    'ce qui inclut les souvenirs remplacés depuis.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Ce que tu cherches, en langage naturel.' },
      kind: {
        type: 'string',
        enum: ['episodic', 'semantic', 'procedural', 'reflective'],
        description: 'Restreindre à une nature de souvenir. Omets pour tout chercher.',
      },
      days: { type: 'number', description: 'Limiter aux N derniers jours.' },
      includeOld: { type: 'boolean', description: 'Inclure les souvenirs remplacés.' },
    },
    required: ['query'],
  },
  async run(input, context) {
    const results = await context.memory.recall({
      text: input.query,
      ...(input.kind ? { kinds: [input.kind] } : {}),
      ...(input.days ? { since: context.clock.now() - input.days * DAY } : {}),
      ...(input.includeOld ? { includeSuperseded: true } : {}),
      limit: 12,
    });

    if (results.length === 0) return { found: 0, message: 'Rien en mémoire là-dessus.' };

    return {
      found: results.length,
      memories: results.map(({ memory, score }) => ({
        contenu: memory.content,
        nature: memory.kind,
        quand: timeAgo(memory.occurredAt ?? memory.createdAt, context.clock.now()),
        statut: memory.status === 'superseded' ? 'remplacé depuis' : 'actuel',
        pertinence: Number(score.toFixed(2)),
      })),
    };
  },
};

const remember: AgentTool<
  {
    content: string;
    kind: MemoryKind;
    importance?: number;
    entities?: string[];
    claim?: { subject: string; predicate: string; object: string };
  },
  unknown
> = {
  name: 'retenir',
  label: 'Enregistre un souvenir',
  description:
    "Enregistre explicitement quelque chose d'important. À utiliser quand la personne te demande " +
    "de retenir quelque chose, ou quand un élément structurant apparaît dans l'échange et mérite " +
    "d'être fixé tout de suite plutôt qu'attendre l'extraction de fin de tour : une décision prise, " +
    'un objectif qui change, une idée à ne pas perdre. Écris le souvenir en une phrase autoportante, ' +
    'compréhensible dans six mois hors de tout contexte.',
  inputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'Le souvenir, en une phrase autoportante.' },
      kind: {
        type: 'string',
        enum: ['episodic', 'semantic', 'procedural', 'reflective'],
        description:
          'episodic = un événement daté ; semantic = un fait durable ; procedural = comment il fonctionne ; reflective = ta propre déduction.',
      },
      importance: { type: 'number', description: '0 anecdotique → 1 structurant.' },
      entities: {
        type: 'array',
        items: { type: 'string' },
        description: 'Noms des projets, personnes ou objectifs concernés.',
      },
      claim: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          predicate: { type: 'string' },
          object: { type: 'string' },
        },
        description:
          'Triplet optionnel pour les faits révisables (objectif, préférence, statut). ' +
          'Permet de détecter les changements d’avis plus tard.',
      },
    },
    required: ['content', 'kind'],
  },
  async run(input, context) {
    const entityIds = (input.entities ?? [])
      .map((name) => context.memory.entities.find(name)?.id)
      .filter((id): id is string => Boolean(id));

    const memory = await context.memory.remember({
      kind: input.kind,
      content: input.content,
      importance: input.importance ?? 0.6,
      confidence: 0.95,
      entityIds,
      ...(input.claim ? { claim: input.claim } : {}),
    });

    return { ok: true, id: memory.id };
  },
};

const upsertEntity: AgentTool<
  {
    name: string;
    type: EntityType;
    description?: string;
    status?: EntityStatus;
  },
  unknown
> = {
  name: 'noter_element',
  label: 'Met à jour le graphe',
  description:
    "Crée ou met à jour un élément structurant de sa vie : un projet, une entreprise, un objectif, " +
    "une habitude, une idée, une décision, une personne. Appelle-le dès qu'un nouvel élément apparaît " +
    "(« j'ai une idée de business », « je lance X ») ou quand un statut change (projet terminé, idée " +
    "abandonnée, objectif atteint). Utilise `incubating` pour une idée en attente : ni morte, ni lancée.",
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      type: {
        type: 'string',
        enum: [
          'project',
          'company',
          'person',
          'goal',
          'habit',
          'idea',
          'decision',
          'skill',
          'tool',
          'place',
          'value',
          'event',
        ],
      },
      description: { type: 'string' },
      status: {
        type: 'string',
        enum: ['active', 'paused', 'done', 'abandoned', 'incubating'],
      },
    },
    required: ['name', 'type'],
  },
  async run(input, context) {
    const entity = context.memory.entities.upsert({
      type: input.type,
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
      ...(input.status ? { status: input.status } : {}),
    });
    return { ok: true, id: entity.id, name: entity.name, statut: entity.status };
  },
};

const inspectEntity: AgentTool<{ name: string }, unknown> = {
  name: 'etat_element',
  label: 'Consulte un projet',
  description:
    "Donne tout ce que tu sais d'un projet, d'une personne ou d'un objectif : description, statut, " +
    "liens avec le reste, souvenirs récents, et depuis combien de temps il n'en a pas parlé. " +
    'À appeler pour « où en est X ? » ou avant de donner un avis sur un de ses projets.',
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
  },
  async run(input, context) {
    const entity = context.memory.entities.find(input.name);
    if (!entity) return { found: false, message: `Aucun élément nommé « ${input.name} ».` };

    const dossier = context.memory.entities.dossier(entity.id);
    if (!dossier) return { found: false };

    return {
      found: true,
      nom: dossier.entity.name,
      type: dossier.entity.type,
      statut: dossier.entity.status,
      description: dossier.entity.description ?? null,
      silenceJours: dossier.daysSinceLastMention,
      mentions: dossier.entity.mentionCount,
      liens: dossier.relations.map((r) => `${r.relation.predicate} → ${r.other.name}`),
      souvenirs: dossier.recentMemories
        .map((id) => context.memory.memories.get(id))
        .filter((memory) => memory !== null)
        .slice(0, 8)
        .map((memory) => truncate(memory.content, 160)),
    };
  },
};

const recordMetric: AgentTool<
  { key: MetricKey; value: number; unit?: string; daysAgo?: number },
  unknown
> = {
  name: 'noter_mesure',
  label: 'Enregistre une mesure',
  description:
    "Enregistre une valeur chiffrée pour le tableau de bord quand la personne la donne explicitement : " +
    "heures travaillées, séance de sport faite, heures de sommeil, humeur, motivation, dépense, revenu. " +
    "N'invente jamais une valeur — si elle n'est pas donnée, ne l'enregistre pas. " +
    'Les échelles subjectives (humeur, motivation, énergie, stress) vont de 0 à 1.',
  inputSchema: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description:
          'productivity, discipline, work_hours, deep_work_hours, sport, sleep_hours, mood, ' +
          'motivation, energy, stress, focus, learning_hours, money_in, money_out — ou une autre clé.',
      },
      value: { type: 'number' },
      unit: { type: 'string' },
      daysAgo: { type: 'number', description: 'Si la valeur concerne un jour passé.' },
    },
    required: ['key', 'value'],
  },
  async run(input, context) {
    const at = context.clock.now() - (input.daysAgo ?? 0) * DAY;
    context.memory.metrics.record({
      key: input.key,
      value: input.value,
      at,
      ...(input.unit ? { unit: input.unit } : {}),
      source: 'declared',
    });
    return { ok: true };
  },
};

const dashboard: AgentTool<{ days?: number }, unknown> = {
  name: 'tableau_de_bord',
  label: 'Analyse ses données',
  description:
    "Renvoie l'état chiffré de sa vie : tendances par dimension (travail, sport, humeur, sommeil…), " +
    'corrélations détectées entre elles, et régularité de ses habitudes. À appeler pour « comment je vais ? », ' +
    '« est-ce que je procrastine ? », « je suis plus productif quand ? », ou avant de porter un jugement ' +
    'sur son rythme — sers-toi des chiffres plutôt que de ton impression.',
  inputSchema: {
    type: 'object',
    properties: { days: { type: 'number', description: 'Fenêtre d’analyse, 90 par défaut.' } },
  },
  async run(input, context) {
    const snapshot = context.memory.metrics.snapshot(input.days ?? 90);
    return {
      tendances: snapshot.trends
        .filter((trend) => trend.sampleSize > 0)
        .map((trend) => ({
          dimension: trend.key,
          semaine: Number(trend.current.toFixed(2)),
          precedente: Number(trend.previous.toFixed(2)),
          variation: `${trend.delta > 0 ? '+' : ''}${Math.round(trend.delta * 100)}%`,
          significatif: Math.abs(trend.zScore) > 1.1,
        })),
      correlations: snapshot.correlations.map(
        (correlation) =>
          `${correlation.a} ↔ ${correlation.b}${correlation.lagDays ? ` (décalage ${correlation.lagDays}j)` : ''} : r=${correlation.r.toFixed(2)} sur ${correlation.sampleSize} jours`,
      ),
      habitudes: snapshot.streaks.map((streak) => ({
        habitude: streak.habit,
        serieEnCours: streak.currentStreak,
        record: streak.bestStreak,
        regularite: `${Math.round(streak.consistency * 100)}%`,
      })),
    };
  },
};

const timeline: AgentTool<{ days?: number }, unknown> = {
  name: 'journal',
  label: 'Relit sa journée',
  description:
    "Reconstitue ce qui s'est passé sur une période : événements retenus, décisions, mesures " +
    "enregistrées. À appeler pour « qu'est-ce que j'ai fait aujourd'hui ? », « ma semaine ? », " +
    "ou pour préparer un bilan. Par défaut : aujourd'hui.",
  inputSchema: {
    type: 'object',
    properties: { days: { type: 'number', description: '0 = aujourd’hui, 7 = la semaine.' } },
  },
  async run(input, context) {
    const days = input.days ?? 0;
    const from =
      days === 0 ? context.clock.startOfDay() : context.clock.now() - days * DAY;

    const memories = context.memory.memories.since(from, ['episodic', 'semantic']);
    const sessions = context.memory.journal
      .recentSessions(20)
      .filter((session) => session.startedAt >= from);

    return {
      periode: days === 0 ? "aujourd'hui" : `${days} derniers jours`,
      evenements: memories.slice(0, 25).map((memory) => ({
        quand: timeAgo(memory.occurredAt ?? memory.createdAt, context.clock.now()),
        quoi: memory.content,
      })),
      echanges: sessions.length,
      resumes: sessions
        .map((session) => session.summary)
        .filter((summary): summary is string => Boolean(summary)),
    };
  },
};

const suggestFocus: AgentTool<Record<string, never>, unknown> = {
  name: 'sur_quoi_travailler',
  label: 'Cherche la priorité',
  description:
    "Rassemble les éléments nécessaires pour recommander sur quoi il devrait travailler maintenant : " +
    "projets actifs et leur silence, objectifs en cours, engagements pris et non tenus, heure et " +
    'rythme habituel. À appeler pour « sur quoi je bosse ? », « par quoi je commence ? ». ' +
    "Tu construis la recommandation toi-même à partir de ces éléments — l'outil ne décide pas à ta place.",
  inputSchema: { type: 'object', properties: {} },
  async run(_input, context) {
    const { memory, clock } = context;

    return {
      heure: `${Math.floor(clock.hourOfDay())}h`,
      heuresProductives: memory.profile.get('rhythms', 'peak_hours', null),
      projets: memory.entities.list({ type: 'project', status: 'active', limit: 10 }).map((project) => ({
        nom: project.name,
        silenceJours: Math.floor((clock.now() - project.lastSeenAt) / DAY),
        importance: Number(project.salience.toFixed(2)),
      })),
      objectifs: memory.entities.list({ type: 'goal', status: 'active', limit: 6 }).map((g) => g.name),
      idéesEnAttente: memory.entities
        .list({ type: 'idea', status: 'incubating', limit: 6 })
        .map((idea) => idea.name),
      dormants: memory.entities.dormant(7).slice(0, 5).map(({ entity, days }) => `${entity.name} (${days}j)`),
      signaux: memory.metrics.significantTrends(7).map((t) => `${t.key} ${t.direction}`),
    };
  },
};

export function createCoreTools(): ToolRegistry {
  return new ToolRegistry()
    .register(searchMemory)
    .register(remember)
    .register(upsertEntity)
    .register(inspectEntity)
    .register(recordMetric)
    .register(dashboard)
    .register(timeline)
    .register(suggestFocus);
}
