import { DAY, attempt, clamp, extractJson, timeAgo } from '@valmont/kernel';
import type { InitiativeDraft, InitiativeKind } from '@valmont/types';
import type { Agent, AgentContext } from './kernel.js';

/**
 * L'agent d'observation : ce qui fait de Valmont un agent et pas un chatbot.
 *
 * Architecture en deux temps, et c'est un choix important :
 *
 *  1. **Détection déterministe.** Les signaux sont calculés en SQL et en
 *     arithmétique — silence d'un projet, décrochage d'une métrique,
 *     contradiction, thème qui monte. Aucun modèle n'intervient. C'est
 *     reproductible, gratuit, auditable, et ça ne peut pas halluciner un
 *     constat. Un agent proactif qui invente ce qu'il observe est pire
 *     qu'inutile : il est nuisible.
 *
 *  2. **Formulation par le modèle.** Le modèle ne sert qu'à dire les choses
 *     bien, à partir de constats déjà établis. Il ne décide pas de quoi parler.
 *
 * La politique de temporisation (`InitiativeStore`) tranche ensuite ce qui est
 * réellement dit et quand.
 */
export class ObserverAgent implements Agent<void, { created: number }> {
  readonly name = 'observer';
  readonly description = 'Détecte ce qui mérite que Valmont prenne la parole de lui-même.';

  async run(_input: void, context: AgentContext): Promise<{ created: number }> {
    const drafts = [
      ...this.dormantProjects(context),
      ...this.trendShifts(context),
      ...this.contradictions(context),
      ...this.risingThemes(context),
      ...this.correlationInsights(context),
      ...this.stalledIdeas(context),
      ...this.progress(context),
    ];

    if (drafts.length === 0) return { created: 0 };

    const phrased = await this.phrase(drafts, context);

    let created = 0;
    for (const draft of phrased) {
      // Un type d'initiative systématiquement rejeté finit par se taire.
      const { rate, sample } = context.memory.initiatives.dismissalRate(draft.kind);
      const penalty = sample >= 4 ? rate * 0.5 : 0;
      const adjusted = { ...draft, confidence: clamp(draft.confidence - penalty) };

      if (context.memory.initiatives.propose(adjusted)) created++;
    }

    context.logger.info('observation terminée', { candidats: drafts.length, retenues: created });
    return { created };
  }

  // ── Détecteurs ────────────────────────────────────────────────────────

  /** « Tu n'as pas parlé de Vintex depuis 10 jours. » */
  private dormantProjects(context: AgentContext): InitiativeDraft[] {
    return context.memory.entities
      .dormant(8)
      .slice(0, 2)
      .map(({ entity, days }) => ({
        kind: 'dormant_project' as const,
        title: `${entity.name} n'a pas été évoqué depuis ${days} jours.`,
        rationale: `Projet actif, saillance ${entity.salience.toFixed(2)}, dernière mention il y a ${days} jours.`,
        // Plus le projet compte, plus le silence est significatif.
        confidence: clamp(0.5 + entity.salience * 0.4),
        priority: clamp(0.4 + entity.salience * 0.4),
        evidence: { entityIds: [entity.id] },
        cooldownKey: `dormant:${entity.id}`,
        cooldownDays: 10,
      }));
  }

  /** « Tu travailles beaucoup moins cette semaine. » */
  private trendShifts(context: AgentContext): InitiativeDraft[] {
    return context.memory.metrics
      .significantTrends(7, 1.3)
      .slice(0, 2)
      .map((trend) => {
        const direction = trend.direction === 'up' ? 'en hausse' : 'en baisse';
        const percent = Math.round(Math.abs(trend.delta) * 100);
        return {
          kind: 'trend_shift' as const,
          title: `${trend.key} ${direction} de ${percent}% cette semaine.`,
          rationale:
            `${trend.key} : ${trend.current.toFixed(2)} vs ${trend.previous.toFixed(2)} ` +
            `(z=${trend.zScore.toFixed(2)}, n=${trend.sampleSize}).`,
          // La confiance suit l'ampleur de l'écart, pas l'intuition.
          confidence: clamp(0.45 + Math.min(0.4, Math.abs(trend.zScore) / 6)),
          priority: trend.direction === 'down' ? 0.75 : 0.5,
          evidence: { metricKeys: [trend.key] },
          cooldownKey: `trend:${trend.key}:${trend.direction}`,
          cooldownDays: 7,
        };
      });
  }

  /** « Tu m'avais dit X, là tu dis Y. » */
  private contradictions(context: AgentContext): InitiativeDraft[] {
    const since = context.clock.now() - 3 * DAY;
    return context.memory.journal
      .events({ kinds: ['contradiction.detected'], since, limit: 5 })
      .map((event) => {
        const payload = event.payload as {
          subject: string;
          before: string;
          after: string;
          previousMemoryId: string;
          currentMemoryId: string;
          previousAt: number;
        };
        return {
          kind: 'contradiction' as const,
          title: `Sur « ${payload.subject} » : c'était « ${payload.before} », c'est devenu « ${payload.after} ».`,
          rationale: `Changement détecté ${timeAgo(payload.previousAt, context.clock.now())}.`,
          confidence: 0.8,
          priority: 0.65,
          evidence: { memoryIds: [payload.previousMemoryId, payload.currentMemoryId] },
          cooldownKey: `contradiction:${payload.subject}`,
          cooldownDays: 21,
        };
      });
  }

  /** « Le sport prend de plus en plus de place chez toi. » */
  private risingThemes(context: AgentContext): InitiativeDraft[] {
    return context.memory.themes
      .rising(0.5)
      .filter((theme) => theme.mentionCount >= 5)
      .slice(0, 1)
      .map((theme) => ({
        kind: 'pattern_insight' as const,
        title: `« ${theme.label} » revient de plus en plus dans ce que tu racontes.`,
        rationale: `Dynamique ${theme.momentum.toFixed(2)}, ${theme.mentionCount} mentions, poids ${(theme.weight * 100).toFixed(0)}% du discours récent.`,
        confidence: clamp(0.5 + theme.momentum * 0.35),
        priority: 0.55,
        evidence: {},
        cooldownKey: `theme:${theme.id}`,
        cooldownDays: 21,
      }));
  }

  /** « Tu sembles plus motivé les jours où tu as fait du sport la veille. » */
  private correlationInsights(context: AgentContext): InitiativeDraft[] {
    return context.memory.metrics
      .correlations()
      .filter((correlation) => Math.abs(correlation.r) >= 0.55 && correlation.sampleSize >= 21)
      .slice(0, 1)
      .map((correlation) => {
        const lag = correlation.lagDays ? ' le lendemain' : '';
        const sense = correlation.r > 0 ? 'monte aussi' : 'baisse';
        return {
          kind: 'pattern_insight' as const,
          title: `Quand ${correlation.a} augmente, ${correlation.b}${lag} ${sense}.`,
          rationale: `r=${correlation.r.toFixed(2)} sur ${correlation.sampleSize} jours communs.`,
          confidence: clamp(0.4 + Math.abs(correlation.r) * 0.5),
          priority: 0.6,
          evidence: { metricKeys: [correlation.a, correlation.b] },
          cooldownKey: `corr:${correlation.a}:${correlation.b}`,
          cooldownDays: 30,
        };
      });
  }

  /** « Cette idée dort depuis trois semaines. On la lance ou on la tue ? » */
  private stalledIdeas(context: AgentContext): InitiativeDraft[] {
    const now = context.clock.now();
    return context.memory.entities
      .list({ type: 'idea', status: 'incubating', limit: 20 })
      .map((entity) => ({ entity, days: Math.floor((now - entity.lastSeenAt) / DAY) }))
      .filter(({ days }) => days >= 21)
      .slice(0, 1)
      .map(({ entity, days }) => ({
        kind: 'idea_review' as const,
        title: `L'idée « ${entity.name} » est en attente depuis ${days} jours.`,
        rationale: `Idée en incubation, aucune mention depuis ${days} jours.`,
        confidence: 0.65,
        priority: 0.45,
        evidence: { entityIds: [entity.id] },
        cooldownKey: `idea:${entity.id}`,
        cooldownDays: 30,
      }));
  }

  /**
   * Les progrès réels comptent autant que les décrochages. Un agent qui ne
   * signale que ce qui va mal devient une source d'anxiété, et on l'éteint.
   */
  private progress(context: AgentContext): InitiativeDraft[] {
    return context.memory.metrics
      .activeKeys()
      .map((key) => context.memory.metrics.streak(key))
      .filter((streak) => streak.currentStreak >= 7 && streak.currentStreak >= streak.bestStreak)
      .slice(0, 1)
      .map((streak) => ({
        kind: 'progress' as const,
        title: `${streak.currentStreak} jours d'affilée sur ${streak.habit} — c'est ton record.`,
        rationale: `Série ${streak.currentStreak}, record ${streak.bestStreak}, régularité ${(streak.consistency * 100).toFixed(0)}%.`,
        confidence: 0.85,
        priority: 0.5,
        evidence: { metricKeys: [streak.habit] },
        cooldownKey: `streak:${streak.habit}`,
        cooldownDays: 14,
      }));
  }

  // ── Formulation ───────────────────────────────────────────────────────

  /**
   * Réécrit les constats dans la voix de Valmont. Les constats bruts sont
   * corrects mais mécaniques (« work_hours en baisse de 63% ») ; le modèle les
   * transforme en phrases qu'une personne dirait. Si l'appel échoue, on garde
   * les titres bruts — moins élégants, jamais faux.
   */
  private async phrase(
    drafts: InitiativeDraft[],
    context: AgentContext,
  ): Promise<InitiativeDraft[]> {
    const result = await attempt(async () => {
      const response = await context.llm.complete({
        system: [
          {
            text:
              "Tu reformules des constats bruts en une phrase que Valmont dirait à l'oral, en français, " +
              'en tutoyant. Direct, court, sans préambule ni point d’exclamation. ' +
              "Une observation, pas un sermon : tu constates, tu ne prescris pas. Tu peux finir par une " +
              "question courte si elle appelle vraiment une réponse.\n\n" +
              "N'ajoute aucun fait qui ne soit pas dans le constat. Ne dramatise pas, ne minimise pas.\n\n" +
              'Réponds en JSON : {"phrases": [{"index": 0, "titre": "...", "corps": "..."}]} — ' +
              '`corps` est optionnel et sert au détail si la personne creuse.',
            cache: true,
          },
        ],
        messages: [
          {
            role: 'user',
            content: drafts
              .map((draft, index) => `[${index}] ${draft.title}\n(données : ${draft.rationale})`)
              .join('\n\n'),
          },
        ],
        model: context.llm.fastModel,
        effort: 'low',
        maxTokens: 1200,
      });

      return extractJson<{ phrases: Array<{ index: number; titre: string; corps?: string }> }>(
        response.text,
      );
    });

    if (!result.ok || !result.value?.phrases) return drafts;

    const byIndex = new Map(result.value.phrases.map((phrase) => [phrase.index, phrase]));
    return drafts.map((draft, index) => {
      const phrase = byIndex.get(index);
      if (!phrase?.titre) return draft;
      return {
        ...draft,
        title: phrase.titre,
        ...(phrase.corps ? { body: phrase.corps } : {}),
      };
    });
  }
}

/** Types d'initiatives que l'observateur sait produire — utile aux réglages. */
export const OBSERVER_KINDS: InitiativeKind[] = [
  'dormant_project',
  'trend_shift',
  'contradiction',
  'pattern_insight',
  'idea_review',
  'progress',
];
