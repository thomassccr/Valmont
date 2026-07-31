import { DAY, attempt, extractJson, truncate } from '@valmont/kernel';
import type { Agent, AgentContext } from './kernel.js';

interface Reflection {
  insights?: Array<{ content: string; importance?: number; sources?: number[] }>;
}

/**
 * Agent de réflexion — la consolidation nocturne.
 *
 * C'est ce qui distingue une base de données d'une mémoire. Chaque nuit,
 * Valmont relit les souvenirs marquants de la période et en tire des
 * observations de niveau supérieur, qu'aucun échange isolé ne contenait :
 *
 *   « Il abandonne ses projets vers la troisième semaine, systématiquement
 *     après un premier retour négatif. »
 *
 * Aucun message ne dit ça. Ça ne se voit qu'en recoupant six semaines. Ces
 * réflexions sont stockées comme des souvenirs à part entière (`reflective`),
 * avec un lien vers leurs sources — elles restent donc contestables et
 * traçables, et remontent naturellement dans les récupérations futures.
 *
 * Inspiré du mécanisme de réflexion des « Generative Agents » (Park et al.),
 * adapté à un utilisateur unique observé sur des années.
 */
export class ReflectionAgent implements Agent<{ days?: number }, { created: number }> {
  readonly name = 'reflection';
  readonly description = 'Recoupe les souvenirs récents pour en tirer des observations de fond.';

  async run(input: { days?: number }, context: AgentContext): Promise<{ created: number }> {
    const days = input.days ?? 7;
    const since = context.clock.now() - days * DAY;

    // On ne réfléchit que sur ce qui compte : les souvenirs anecdotiques
    // produisent des réflexions anecdotiques.
    const candidates = context.memory.memories
      .since(since, ['episodic', 'semantic'])
      .filter((memory) => memory.importance >= 0.4)
      .slice(0, 60);

    if (candidates.length < 8) {
      context.logger.debug('réflexion ignorée, trop peu de matière', { count: candidates.length });
      return { created: 0 };
    }

    const numbered = candidates
      .map((memory, index) => `[${index}] ${truncate(memory.content, 240)}`)
      .join('\n');

    const themes = context.memory.themes
      .list(8)
      .map((theme) => `- ${theme.label} (dynamique ${theme.momentum.toFixed(2)})`)
      .join('\n');

    const result = await attempt(async () => {
      const response = await context.llm.complete({
        system: [
          {
            text: `Tu relis les souvenirs récents d'une personne et tu en tires des observations de fond.

Une bonne observation :
- n'est écrite nulle part dans les souvenirs — elle naît du recoupement de plusieurs ;
- porte sur un schéma, une tension, une évolution, une causalité probable ;
- reste vraie dans six mois, contrairement à un événement isolé ;
- est formulée en une phrase, précise, sans jargon psychologisant.

Exemples de ce qu'on cherche :
- « Ses projets s'arrêtent le plus souvent après un premier retour négatif, pas par manque de temps. »
- « Il travaille mieux quand il a une échéance externe ; sans contrainte, il repousse. »
- « Le sport et la clarté de ses décisions vont ensemble chez lui. »

Contre-exemples à éviter :
- « Il a fait du sport plusieurs fois. » (c'est un résumé, pas une observation)
- « Il devrait mieux s'organiser. » (c'est un conseil, pas une observation)
- « Il traverse une période difficile. » (trop vague pour être utile)

N'invente rien. Si les souvenirs ne soutiennent aucune observation solide, renvoie une liste vide — c'est une réponse correcte et fréquente.

Réponds en JSON : {"insights":[{"content":"...","importance":0.7,"sources":[0,3,7]}]}
Trois observations maximum.`,
            cache: true,
          },
        ],
        messages: [
          {
            role: 'user',
            content:
              `Souvenirs des ${days} derniers jours :\n${numbered}` +
              (themes ? `\n\nThèmes en cours :\n${themes}` : ''),
          },
        ],
        // Effort élevé : c'est la seule tâche du système où le raisonnement
        // profond change vraiment la qualité du résultat.
        effort: 'high',
        maxTokens: 2048,
      });

      return extractJson<Reflection>(response.text);
    });

    if (!result.ok || !result.value?.insights) {
      context.logger.warn('réflexion sans résultat', {
        error: result.ok ? 'json illisible' : String(result.error),
      });
      return { created: 0 };
    }

    let created = 0;
    for (const insight of result.value.insights) {
      if (!insight.content?.trim()) continue;

      const sources = (insight.sources ?? [])
        .map((index) => candidates[index]?.id)
        .filter((id): id is string => Boolean(id));

      // Les entités des souvenirs sources sont héritées : une réflexion sur
      // « ses projets » doit remonter quand on parle d'un de ces projets.
      const entityIds = [
        ...new Set(
          sources.flatMap((id) => context.memory.memories.get(id)?.entityIds ?? []),
        ),
      ];

      await context.memory.remember({
        kind: 'reflective',
        content: insight.content.trim(),
        importance: insight.importance ?? 0.7,
        // Jamais plus de 0,7 : c'est une déduction de Valmont, pas une parole
        // de la personne. Elle doit rester révisable.
        confidence: 0.7,
        derivedFrom: sources,
        entityIds,
        tags: ['réflexion'],
      });
      created++;
    }

    context.bus.emit({
      kind: 'reflection.completed',
      actor: 'reflection',
      payload: { created, considered: candidates.length, days },
    });
    context.logger.info('réflexion terminée', { created, considered: candidates.length });

    return { created };
  }
}

/**
 * Résumé de session. Sans lui, un an de conversations devient illisible :
 * on ne peut pas relire 4 000 messages, mais on peut relire 300 résumés.
 */
export class SummarizerAgent implements Agent<void, { summarized: number }> {
  readonly name = 'summarizer';
  readonly description = 'Résume les sessions terminées.';

  async run(_input: void, context: AgentContext): Promise<{ summarized: number }> {
    const sessions = context.memory.journal.unsummarizedSessions(5);
    let summarized = 0;

    for (const session of sessions) {
      const messages = context.memory.journal.messages(session.id, 100);
      if (messages.length < 2) continue;

      const transcript = messages
        .map((message) => `${message.role === 'user' ? 'Lui' : 'Valmont'} : ${truncate(message.content, 800)}`)
        .join('\n');

      const result = await attempt(async () => {
        const response = await context.llm.complete({
          system: [
            {
              text:
                "Résume cet échange en trois phrases maximum : de quoi il a été question, ce qui a été " +
                "décidé s'il y a eu une décision, et l'état d'esprit apparent de la personne. " +
                'Factuel, à la troisième personne. Puis propose un titre de cinq mots maximum.\n\n' +
                'Réponds en JSON : {"resume":"...","titre":"..."}',
              cache: true,
            },
          ],
          messages: [{ role: 'user', content: truncate(transcript, 20000) }],
          model: context.llm.fastModel,
          effort: 'low',
          maxTokens: 700,
        });
        return extractJson<{ resume: string; titre: string }>(response.text);
      });

      if (!result.ok || !result.value?.resume) continue;

      context.memory.journal.endSession(session.id, result.value.resume);
      if (result.value.titre) {
        context.memory.journal.setSessionTitle(session.id, result.value.titre);
      }
      summarized++;
    }

    if (summarized > 0) context.logger.info('sessions résumées', { summarized });
    return { summarized };
  }
}
