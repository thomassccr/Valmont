import { DAY, estimateTokens, timeAgo, truncate } from '@valmont/kernel';
import type { LLMRequest } from '@valmont/llm';
import type { ContextBundle, MemoryId, ScoredMemory, SessionId } from '@valmont/types';
import type { AgentContext } from './kernel.js';
import { buildPersona, buildToneDirectives } from './persona.js';

export interface ContextOptions {
  /** Budget de jetons pour tout ce qui est injecté (hors historique). */
  budgetTokens?: number;
  /** Nombre de souvenirs récupérés au maximum. */
  memoryLimit?: number;
  sessionId?: SessionId;
}

/**
 * Assemblage du contexte.
 *
 * C'est le point le plus délicat du système. Un contexte trop pauvre donne un
 * assistant amnésique ; un contexte trop chargé noie le modèle et coûte cher.
 * L'ordre est aussi important que le contenu : ce qui est stable en premier
 * (mis en cache, payé une fois), ce qui est volatile en dernier.
 *
 * Segments, dans l'ordre de rendu :
 *   1. Persona           — figé, mis en cache
 *   2. Profil + entités  — évolue lentement, mis en cache
 *   3. Instant présent   — volatile, jamais mis en cache
 *   4. Souvenirs         — volatile
 *   5. Initiative        — volatile
 *
 * Un seul octet qui change dans un segment invalide le cache de tout ce qui
 * suit : c'est pour ça que l'heure courante n'est jamais dans la persona.
 */
export class ContextAssembler {
  constructor(private readonly context: AgentContext) {}

  async build(
    userText: string,
    options: ContextOptions = {},
  ): Promise<{ system: NonNullable<LLMRequest['system']>; bundle: ContextBundle }> {
    const { memory, clock } = this.context;
    const budget = options.budgetTokens ?? 12000;
    const sections: string[] = [];

    const persona = memory.profile.persona();
    const profile = memory.profile.profile();

    // ── 1. Persona (cache) ───────────────────────────────────────────────
    const personaText = buildPersona(persona, profile);
    sections.push('persona');

    // ── 2. Ce qu'il sait de lui (cache) ──────────────────────────────────
    const knowledge = this.buildKnowledge();
    if (knowledge) sections.push('profil');

    // ── 3. Instant présent (volatile) ────────────────────────────────────
    const present = this.buildPresent();
    sections.push('présent');

    // ── 4. Souvenirs pertinents (volatile) ───────────────────────────────
    const entityIds = this.mentionedEntities(userText);
    const recalled = await memory.recall({
      text: userText,
      entityIds,
      limit: options.memoryLimit ?? 14,
    });

    const memoryIds: MemoryId[] = [];
    const memoryText = this.buildMemories(recalled, budget - estimateTokens(knowledge + present), memoryIds);
    if (memoryText) sections.push('souvenirs');

    // ── 5. Initiative en attente (volatile) ──────────────────────────────
    const initiative = memory.initiatives.nextDeliverable();
    const initiativeText = initiative
      ? `# À soulever si le moment s'y prête\n${initiative.title}\n(Pourquoi : ${initiative.rationale})\n` +
        `Amène-le naturellement, seulement si ça s'insère dans la conversation. Si ça ne colle pas, ignore.`
      : '';
    if (initiativeText) sections.push('initiative');

    const tone = buildToneDirectives(persona);

    const system: NonNullable<LLMRequest['system']> = [
      { text: personaText, cache: true },
      ...(knowledge ? [{ text: knowledge, cache: true }] : []),
      ...(tone ? [{ text: tone }] : []),
      { text: present },
      ...(memoryText ? [{ text: memoryText }] : []),
      ...(initiativeText ? [{ text: initiativeText }] : []),
    ];

    const estimatedTokens = system.reduce((sum, part) => sum + estimateTokens(part.text), 0);
    this.context.logger.debug('contexte assemblé', {
      sections: sections.length,
      memories: memoryIds.length,
      tokens: estimatedTokens,
    });

    return { system, bundle: { memoryIds, estimatedTokens, sections } };
  }

  /**
   * Ce que Valmont sait de la personne : profil appris, projets actifs,
   * objectifs, thèmes du moment. C'est le socle qui rend les réponses
   * personnelles sans qu'aucun souvenir précis soit rappelé.
   */
  private buildKnowledge(): string {
    const { memory, clock } = this.context;
    const parts: string[] = [];

    const profile = memory.profile.profile();
    const traits = [
      ...profile.rhythms,
      ...profile.methods,
      ...profile.style,
      ...profile.preferences,
      ...profile.personality,
    ].filter((trait) => trait.confidence >= 0.45);

    if (profile.identity.name) parts.push(`Prénom : ${profile.identity.name}`);
    if (traits.length > 0) {
      parts.push(
        `Ce que tu as observé de son fonctionnement :\n${traits
          .map((trait) => `- ${trait.key} : ${formatValue(trait.value)} (${Math.round(trait.confidence * 100)}%)`)
          .join('\n')}`,
      );
    }

    const projects = memory.entities.list({ type: 'project', status: 'active', limit: 10 });
    if (projects.length > 0) {
      parts.push(
        `Projets en cours :\n${projects
          .map((project) => {
            const days = Math.floor((clock.now() - project.lastSeenAt) / DAY);
            const silence = days >= 7 ? ` — pas évoqué depuis ${days} jours` : '';
            return `- ${project.name}${project.description ? ` : ${truncate(project.description, 120)}` : ''}${silence}`;
          })
          .join('\n')}`,
      );
    }

    const goals = memory.entities.list({ type: 'goal', status: 'active', limit: 6 });
    if (goals.length > 0) {
      parts.push(`Objectifs actifs :\n${goals.map((goal) => `- ${goal.name}`).join('\n')}`);
    }

    const incubating = memory.entities.list({ type: 'idea', status: 'incubating', limit: 6 });
    if (incubating.length > 0) {
      parts.push(`Idées en attente :\n${incubating.map((idea) => `- ${idea.name}`).join('\n')}`);
    }

    const people = memory.entities.list({ type: 'person', limit: 8 });
    if (people.length > 0) {
      parts.push(
        `Personnes qui comptent : ${people.map((person) => person.name).join(', ')}`,
      );
    }

    const themes = memory.themes.list(6);
    if (themes.length > 0) {
      parts.push(
        `Sujets qui occupent son esprit en ce moment :\n${themes
          .map((theme) => {
            const arrow = theme.momentum > 0.3 ? ' ↑ en hausse' : theme.momentum < -0.3 ? ' ↓ en baisse' : '';
            return `- ${theme.label}${arrow}`;
          })
          .join('\n')}`,
      );
    }

    return parts.length > 0 ? `# Ce que tu sais de lui\n${parts.join('\n\n')}` : '';
  }

  /**
   * Instant présent. Court volontairement : c'est le segment qui invalide le
   * cache à chaque appel, donc chaque ligne s'y paie plein tarif.
   */
  private buildPresent(): string {
    const { memory, clock } = this.context;
    const now = new Date(clock.now());

    const formatted = new Intl.DateTimeFormat('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(now);

    const parts = [`# Maintenant\n${formatted}`];

    const trends = memory.metrics.significantTrends(7, 1.2).slice(0, 3);
    if (trends.length > 0) {
      parts.push(
        `Signaux de la semaine :\n${trends
          .map(
            (trend) =>
              `- ${trend.key} ${trend.direction === 'up' ? '↑' : '↓'} ${Math.round(Math.abs(trend.delta) * 100)}% vs semaine précédente`,
          )
          .join('\n')}`,
      );
    }

    const last = memory.journal.recentSessions(2).at(1);
    if (last?.summary) {
      parts.push(`Dernier échange (${timeAgo(last.startedAt, clock.now())}) : ${truncate(last.summary, 300)}`);
    }

    return parts.join('\n\n');
  }

  /**
   * Souvenirs, groupés par nature. Le regroupement compte : mélanger un fait
   * stable et un événement de mardi dernier dans une même liste brouille la
   * hiérarchie et pousse le modèle à traiter l'anecdote comme une vérité.
   */
  private buildMemories(recalled: ScoredMemory[], budget: number, out: MemoryId[]): string {
    if (recalled.length === 0) return '';

    const groups: Record<string, string[]> = {
      semantic: [],
      procedural: [],
      reflective: [],
      episodic: [],
    };

    let used = 0;
    for (const { memory } of recalled) {
      const when =
        memory.kind === 'episodic'
          ? ` (${timeAgo(memory.occurredAt ?? memory.createdAt, this.context.clock.now())})`
          : '';
      const line = `- ${memory.content}${when}`;
      const cost = estimateTokens(line);
      if (used + cost > budget) break;
      used += cost;
      groups[memory.kind]?.push(line);
      out.push(memory.id);
    }

    const labels: Record<string, string> = {
      semantic: 'Ce qui est vrai de lui',
      procedural: 'Comment il fonctionne',
      reflective: 'Ce que tu as déduit',
      episodic: 'Ce qui s’est passé',
    };

    const blocks = Object.entries(groups)
      .filter(([, lines]) => lines.length > 0)
      .map(([kind, lines]) => `## ${labels[kind]}\n${lines.join('\n')}`);

    if (blocks.length === 0) return '';
    return `# Souvenirs pertinents\n${blocks.join('\n\n')}`;
  }

  /** Entités citées dans le message — biaise la récupération vers le sujet réel. */
  private mentionedEntities(text: string): string[] {
    const found: string[] = [];
    for (const entity of this.context.memory.entities.list({ limit: 300 })) {
      const needle = entity.name.toLowerCase();
      if (needle.length < 3) continue;
      if (text.toLowerCase().includes(needle)) found.push(entity.id);
    }
    return found;
  }
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.join(', ');
  return JSON.stringify(value);
}
