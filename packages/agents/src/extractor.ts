import { attempt, clamp, extractJson, truncate } from '@valmont/kernel';
import type { EntityStatus, EntityType, MemoryKind, MetricKey, SessionId } from '@valmont/types';
import type { Agent, AgentContext } from './kernel.js';

interface Extraction {
  memories?: Array<{
    content: string;
    kind: MemoryKind;
    importance?: number;
    confidence?: number;
    valence?: number;
    entities?: string[];
    claim?: { subject: string; predicate: string; object: string };
  }>;
  entities?: Array<{
    name: string;
    type: EntityType;
    description?: string;
    status?: EntityStatus;
  }>;
  relations?: Array<{ from: string; to: string; predicate: string }>;
  metrics?: Array<{ key: MetricKey; value: number; source: 'declared' | 'inferred' }>;
  affect?: { mood?: number; motivation?: number; energy?: number; stress?: number };
  profile?: Array<{
    section: 'style' | 'rhythms' | 'preferences' | 'personality' | 'methods';
    key: string;
    value: string;
  }>;
}

const INSTRUCTIONS = `Tu es le module de mémoire de Valmont. Tu lis un échange et tu en extrais ce qui mérite d'être retenu durablement.

Tu ne réponds pas à la personne. Tu produis uniquement du JSON.

# Ce qu'il faut retenir
- Les faits durables sur elle : objectifs, préférences, valeurs, situation, compétences.
- Les événements datés qui comptent : décision prise, projet lancé ou abandonné, échec, réussite, rencontre.
- Sa manière de fonctionner : horaires productifs, méthodes de travail, déclencheurs de motivation ou de blocage.
- Les personnes, projets, entreprises, objectifs, habitudes, idées mentionnés.
- Les valeurs chiffrées explicitement données (heures travaillées, sommeil, sport, argent).
- Son état émotionnel du moment, si le message le laisse lire.

# Ce qu'il ne faut PAS retenir
- Le contenu des réponses de Valmont — seulement ce que la personne dit ou révèle.
- Les banalités conversationnelles, les questions factuelles sans portée personnelle.
- Ce qui est déjà évident et permanent (« il utilise un ordinateur »).
- Une déduction que rien ne soutient. Dans le doute, n'écris rien : une mémoire vide vaut mieux qu'une mémoire fausse.

# Règles d'écriture
- Chaque souvenir est une phrase autoportante, compréhensible dans six mois sans le contexte de l'échange. Écris « Thomas a décidé de mettre Vintex en pause pour se concentrer sur X », pas « il a décidé de le mettre en pause ».
- \`importance\` : 0,2 anecdotique · 0,5 notable · 0,8 structurant · 1,0 fondateur.
- \`confidence\` : 1,0 s'il l'a dit explicitement · 0,6 si tu l'infères raisonnablement · en dessous, n'écris pas.
- \`valence\` : de -1 (douloureux) à +1 (positif).
- \`claim\` : à remplir uniquement pour un fait révisable (objectif chiffré, préférence, statut d'un projet). C'est ce qui permettra de détecter un changement d'avis plus tard.
- \`affect\` : valeurs entre 0 et 1. Ne renseigne que ce que le message soutient réellement.

Réponds avec un unique objet JSON, sans texte autour :
{"memories":[],"entities":[],"relations":[],"metrics":[],"affect":{},"profile":[]}
Un tableau vide est une réponse parfaitement valable, et c'est souvent la bonne.`;

export interface ExtractorInput {
  sessionId: SessionId;
  userText: string;
  valmontText: string;
}

/**
 * Agent d'extraction.
 *
 * Tourne **après** la réponse, jamais pendant : la personne ne doit jamais
 * attendre que la mémoire se mette à jour. Un échec ici est sans conséquence
 * sur la conversation — le message brut reste dans le journal et pourra être
 * réextrait plus tard.
 *
 * Modèle rapide et effort bas : c'est une tâche de structuration, pas de
 * raisonnement. Y mettre le modèle de conversation coûterait dix fois plus
 * cher pour un résultat équivalent.
 */
export class ExtractorAgent implements Agent<ExtractorInput, void> {
  readonly name = 'extractor';
  readonly description = 'Transforme un échange en souvenirs, entités et mesures.';

  async run(input: ExtractorInput, context: AgentContext): Promise<void> {
    if (input.userText.trim().length < 12) return; // « ok », « merci » : rien à retenir

    const result = await attempt(async () => {
      const response = await context.llm.complete({
        system: [{ text: INSTRUCTIONS, cache: true }],
        messages: [
          {
            role: 'user',
            content:
              `<personne>\n${truncate(input.userText, 6000)}\n</personne>\n\n` +
              `<valmont>\n${truncate(input.valmontText, 3000)}\n</valmont>`,
          },
        ],
        model: context.llm.fastModel,
        effort: 'low',
        maxTokens: 2048,
      });
      return extractJson<Extraction>(response.text);
    });

    if (!result.ok || !result.value) {
      context.logger.warn('extraction sans résultat exploitable', {
        error: result.ok ? 'json illisible' : String(result.error),
      });
      return;
    }

    await this.apply(result.value, input, context);
  }

  private async apply(
    extraction: Extraction,
    input: ExtractorInput,
    context: AgentContext,
  ): Promise<void> {
    const { memory, clock } = context;
    const resolved = new Map<string, string>();

    // 1. Entités d'abord : les souvenirs devront s'y rattacher.
    for (const entity of extraction.entities ?? []) {
      if (!entity.name?.trim()) continue;
      const record = memory.entities.upsert({
        type: entity.type,
        name: entity.name,
        ...(entity.description ? { description: entity.description } : {}),
        ...(entity.status ? { status: entity.status } : {}),
      });
      resolved.set(entity.name.toLowerCase(), record.id);
    }

    // 2. Relations.
    for (const relation of extraction.relations ?? []) {
      const from = this.resolve(relation.from, resolved, context);
      const to = this.resolve(relation.to, resolved, context);
      if (from && to && from !== to) {
        memory.entities.relate(from, to, relation.predicate);
      }
    }

    // 3. Souvenirs.
    for (const draft of extraction.memories ?? []) {
      if (!draft.content?.trim()) continue;
      if ((draft.confidence ?? 1) < 0.5) continue;

      const entityIds = (draft.entities ?? [])
        .map((name) => this.resolve(name, resolved, context))
        .filter((id): id is string => Boolean(id));

      await memory.remember({
        kind: draft.kind ?? 'episodic',
        content: draft.content.trim(),
        importance: clamp(draft.importance ?? 0.5),
        confidence: clamp(draft.confidence ?? 0.8),
        valence: clamp(draft.valence ?? 0, -1, 1),
        sessionId: input.sessionId,
        entityIds,
        ...(draft.claim ? { claim: draft.claim } : {}),
      });
    }

    // 4. Mesures déclarées.
    for (const metric of extraction.metrics ?? []) {
      if (typeof metric.value !== 'number' || Number.isNaN(metric.value)) continue;
      memory.metrics.record({
        key: metric.key,
        value: metric.value,
        source: metric.source ?? 'inferred',
      });
    }

    // 5. État affectif. Enregistré comme métrique *et* sur la session : la
    //    métrique alimente les tendances, la session alimente le contexte.
    const affect = extraction.affect ?? {};
    const affectKeys: Array<[keyof typeof affect, MetricKey]> = [
      ['mood', 'mood'],
      ['motivation', 'motivation'],
      ['energy', 'energy'],
      ['stress', 'stress'],
    ];
    for (const [field, key] of affectKeys) {
      const value = affect[field];
      if (typeof value !== 'number') continue;
      memory.metrics.record({
        key,
        value: clamp(value),
        source: 'inferred',
        confidence: 0.55,
      });
    }
    if (affect.mood !== undefined || affect.motivation !== undefined || affect.energy !== undefined) {
      memory.journal.setSessionAffect(input.sessionId, {
        ...(affect.mood !== undefined ? { mood: clamp(affect.mood) } : {}),
        ...(affect.motivation !== undefined ? { motivation: clamp(affect.motivation) } : {}),
        ...(affect.energy !== undefined ? { energy: clamp(affect.energy) } : {}),
      });
    }

    // 6. Traits de profil — accumulés lentement, jamais affirmés d'un coup.
    for (const trait of extraction.profile ?? []) {
      if (!trait.key || trait.value === undefined) continue;
      memory.profile.observe(trait.section, trait.key, trait.value, {
        evidence: truncate(input.userText, 200),
      });
    }

    // 7. Rythme d'activité observé : quand parle-t-il, à quelle heure ?
    //    Signal purement comportemental, indépendant de ce qu'il déclare.
    const hour = Math.floor(clock.hourOfDay());
    memory.metrics.record({
      key: 'activity_hour',
      value: hour,
      source: 'observed',
      confidence: 1,
    });

    context.logger.debug('extraction appliquée', {
      memories: extraction.memories?.length ?? 0,
      entities: extraction.entities?.length ?? 0,
      metrics: extraction.metrics?.length ?? 0,
    });
  }

  /** Résout un nom vers un identifiant, en réutilisant le graphe existant. */
  private resolve(
    name: string | undefined,
    resolved: Map<string, string>,
    context: AgentContext,
  ): string | null {
    if (!name?.trim()) return null;
    const direct = resolved.get(name.toLowerCase());
    if (direct) return direct;
    return context.memory.entities.find(name)?.id ?? null;
  }
}
