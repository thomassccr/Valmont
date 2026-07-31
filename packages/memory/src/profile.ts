import { clamp, type Clock } from '@valmont/kernel';
import {
  DEFAULT_PERSONA,
  type EventBus,
  type PersonaSettings,
  type ProfileTrait,
  type UserProfile,
} from '@valmont/types';
import { parseJson, toJson, type Db } from './db.js';

type Section = 'style' | 'rhythms' | 'preferences' | 'personality' | 'methods' | 'identity' | 'persona';

interface TraitRow {
  section: string;
  key: string;
  value: string;
  confidence: number;
  observations: number;
  evidence: string | null;
  updated_at: number;
}

/**
 * Profil appris.
 *
 * Distinction importante avec la mémoire : la mémoire retient **ce qu'il a
 * dit**, le profil retient **comment il fonctionne**. « Il a dit qu'il était
 * fatigué mardi » est un souvenir ; « il est plus lucide le matin » est un
 * trait de profil, déduit de dizaines d'observations.
 *
 * Chaque trait porte un compteur d'observations et une confiance qui monte
 * lentement. Un assistant qui affirme votre personnalité après trois échanges
 * se trompe avec aplomb — c'est pire que de ne rien savoir.
 */
export class ProfileStore {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly bus: EventBus,
  ) {}

  /**
   * Enregistre une observation.
   *
   * La confiance suit une courbe à rendements décroissants : elle grimpe vite
   * sur les premières observations concordantes, puis se stabilise. Une
   * observation qui contredit le trait courant fait *baisser* la confiance
   * avant de faire changer la valeur — le profil résiste au bruit mais cède
   * devant un vrai changement.
   */
  observe<T>(
    section: Section,
    key: string,
    value: T,
    options: { evidence?: string; weight?: number } = {},
  ): ProfileTrait<T> {
    const now = this.clock.now();
    const existing = this.db
      .prepare<[string, string], TraitRow>(
        'SELECT * FROM profile_traits WHERE section = ? AND key = ?',
      )
      .get(section, key);

    const weight = options.weight ?? 1;

    if (!existing) {
      const trait: ProfileTrait<T> = {
        key,
        value,
        confidence: clamp(0.25 * weight, 0, 0.5),
        observations: 1,
        updatedAt: now,
        ...(options.evidence ? { evidence: options.evidence } : {}),
      };
      this.db
        .prepare(
          `INSERT INTO profile_traits (section, key, value, confidence, observations, evidence, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(section, key, toJson(value), trait.confidence, options.evidence ?? null, now);
      return trait;
    }

    const previous = parseJson<T>(existing.value, value);
    const agrees = JSON.stringify(previous) === JSON.stringify(value);
    const observations = existing.observations + 1;

    // Rendements décroissants : 1 - 1/(1 + n/4), plafonné à 0,95.
    const confidence = agrees
      ? clamp(Math.min(0.95, 1 - 1 / (1 + observations / 4)))
      : clamp(existing.confidence * 0.6);

    // On ne remplace la valeur que si la contradiction persiste : soit la
    // confiance est tombée bas, soit l'observation est fortement pondérée.
    const nextValue = agrees || confidence < 0.35 || weight >= 2 ? value : previous;

    this.db
      .prepare(
        `UPDATE profile_traits
         SET value = ?, confidence = ?, observations = ?, evidence = coalesce(?, evidence), updated_at = ?
         WHERE section = ? AND key = ?`,
      )
      .run(
        toJson(nextValue),
        confidence,
        observations,
        options.evidence ?? null,
        now,
        section,
        key,
      );

    this.bus.emit({
      kind: 'profile.updated',
      actor: 'memory',
      payload: { section, key, confidence, agrees },
    });

    return {
      key,
      value: nextValue,
      confidence,
      observations,
      updatedAt: now,
      ...(options.evidence ? { evidence: options.evidence } : {}),
    };
  }

  /** Écriture directe, sans apprentissage — pour les réglages explicites. */
  set<T>(section: Section, key: string, value: T, confidence = 1): void {
    this.db
      .prepare(
        `INSERT INTO profile_traits (section, key, value, confidence, observations, updated_at)
         VALUES (?, ?, ?, ?, 1, ?)
         ON CONFLICT(section, key) DO UPDATE SET
           value = excluded.value, confidence = excluded.confidence, updated_at = excluded.updated_at`,
      )
      .run(section, key, toJson(value), confidence, this.clock.now());
  }

  get<T>(section: Section, key: string, fallback: T): T {
    const row = this.db
      .prepare<[string, string], TraitRow>(
        'SELECT * FROM profile_traits WHERE section = ? AND key = ?',
      )
      .get(section, key);
    return row ? parseJson<T>(row.value, fallback) : fallback;
  }

  section(section: Section, minConfidence = 0.3): ProfileTrait[] {
    return this.db
      .prepare<[string, number], TraitRow>(
        'SELECT * FROM profile_traits WHERE section = ? AND confidence >= ? ORDER BY confidence DESC',
      )
      .all(section, minConfidence)
      .map(hydrate);
  }

  profile(): UserProfile {
    return {
      identity: {
        name: this.get('identity', 'name', undefined as string | undefined),
        pronouns: this.get('identity', 'pronouns', undefined as string | undefined),
        timezone: this.get('identity', 'timezone', this.clock.timezone),
        locale: this.get('identity', 'locale', 'fr-FR'),
      },
      style: this.section('style'),
      rhythms: this.section('rhythms'),
      preferences: this.section('preferences'),
      personality: this.section('personality'),
      methods: this.section('methods'),
      updatedAt:
        this.db
          .prepare<[], { at: number | null }>('SELECT MAX(updated_at) AS at FROM profile_traits')
          .get()?.at ?? this.clock.now(),
    };
  }

  persona(): PersonaSettings {
    return {
      directness: this.get('persona', 'directness', DEFAULT_PERSONA.directness),
      verbosity: this.get('persona', 'verbosity', DEFAULT_PERSONA.verbosity),
      warmth: this.get('persona', 'warmth', DEFAULT_PERSONA.warmth),
      proactivity: this.get('persona', 'proactivity', DEFAULT_PERSONA.proactivity),
      informal: this.get('persona', 'informal', DEFAULT_PERSONA.informal),
      customInstructions: this.get('persona', 'customInstructions', undefined as string | undefined),
    };
  }

  setPersona(settings: Partial<PersonaSettings>): void {
    for (const [key, value] of Object.entries(settings)) {
      if (value !== undefined) this.set('persona', key, value);
    }
  }
}

function hydrate(row: TraitRow): ProfileTrait {
  return {
    key: row.key,
    value: parseJson<unknown>(row.value, null),
    confidence: row.confidence,
    observations: row.observations,
    updatedAt: row.updated_at,
    ...(row.evidence ? { evidence: row.evidence } : {}),
  };
}
