import type { Timestamp } from './ids.js';

/**
 * Le profil est ce que Valmont a appris de *comment* fonctionne l'utilisateur,
 * par opposition à la mémoire qui retient *ce qu'il a dit*.
 *
 * Chaque trait est daté et pondéré par une confiance : un profil affirmé trop
 * vite produit un assistant qui se trompe avec assurance, ce qui est pire
 * qu'un assistant qui ne sait pas.
 */
export interface ProfileTrait<T = unknown> {
  key: string;
  value: T;
  confidence: number;
  /** Nombre d'observations ayant contribué à ce trait. */
  observations: number;
  updatedAt: Timestamp;
  /** Résumé de la preuve, en clair. */
  evidence?: string;
}

export interface UserProfile {
  /** Comment s'adresser à lui, ton attendu, niveau de franchise. */
  identity: {
    name?: string;
    pronouns?: string;
    timezone: string;
    locale: string;
  };

  /** Style d'écriture et de parole : longueur, vocabulaire, tutoiement… */
  style: ProfileTrait[];
  /** Rythmes : heures productives, jours creux, rituels. */
  rhythms: ProfileTrait[];
  /** Préférences explicites et implicites (format des réponses, ton…). */
  preferences: ProfileTrait[];
  /** Traits de personnalité observés, sans jugement clinique. */
  personality: ProfileTrait[];
  /** Méthodes de travail qui marchent pour lui. */
  methods: ProfileTrait[];

  updatedAt: Timestamp;
}

/**
 * Réglages de la persona. Ce n'est pas de la décoration : c'est le contrat
 * relationnel. `directness` élevé = Valmont challenge vraiment.
 */
export interface PersonaSettings {
  /** 0 → diplomate, 1 → brutalement honnête. */
  directness: number;
  /** 0 → laconique, 1 → développe. */
  verbosity: number;
  /** 0 → jamais d'humour, 1 → complice. */
  warmth: number;
  /** 0 → attend qu'on lui parle, 1 → prend l'initiative souvent. */
  proactivity: number;
  /** Tutoiement (vrai par défaut en français). */
  informal: boolean;
  /** Instructions libres ajoutées à l'invite système. */
  customInstructions?: string;
}

export const DEFAULT_PERSONA: PersonaSettings = {
  directness: 0.75,
  verbosity: 0.35,
  warmth: 0.6,
  proactivity: 0.6,
  informal: true,
};
