/**
 * Types partagés entre le serveur (Express) et le client (React).
 * Source de vérité unique : toute évolution du modèle de données passe ici.
 */

/* ─────────────────────────  Utilisateurs  ───────────────────────── */

export type UserRole = 'admin' | 'operator';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  created_at: string;
}

/* ─────────────────────────  Créateurs  ───────────────────────── */

export type EmojiStyle = 'aucun' | 'rare' | 'modere' | 'intensif';
export type Punctuation = 'sobre' | 'standard' | 'expressive';
export type Capitalization = 'minuscules' | 'standard';
export type MessageLength = 'court' | 'moyen' | 'long';

/** Tout ce qui définit « comment » le créateur écrit. */
export interface CreatorLexicon {
  language: string;
  preferred_words: string[];
  banned_words: string[];
  signature_phrases: string[];
  favorite_emojis: string[];
  emoji_style: EmojiStyle;
  punctuation: Punctuation;
  capitalization: Capitalization;
  typical_message_length: MessageLength;
}

/** Garde-fous éditoriaux et de conformité, appliqués à la génération ET à la validation. */
export interface CreatorGuardrails {
  banned_topics: string[];
  hard_rules: string[];
  /** Interdit toute promesse de contenu / service non confirmé. */
  no_promises: boolean;
  /** Interdit d'inventer des faits vérifiables (ville, âge, agenda, santé, finances…). */
  no_personal_facts: boolean;
  /** Longueur maximale d'un message suggéré, en caractères. */
  max_message_chars: number;
}

export interface Creator {
  id: string;
  name: string;
  handle: string;
  accent_color: string;
  /** URL ou data-URI de l'avatar. Vide = initiales sur fond coloré. */
  avatar_url: string;
  /** Âge affiché dans la persona. 0 = non renseigné. */
  age: number;
  personality: string;
  traits: string[];
  tone: string;
  interests: string[];
  writing_style: string;
  audience_type: string;
  preferred_topics: string[];
  objectives: string[];
  /** Type de contenu produit (photos, vidéos, custom…), utilisé dans la persona. */
  content_style: string;
  /** Consignes libres injectées telles quelles dans le prompt système. */
  custom_instructions: string;
  lexicon: CreatorLexicon;
  guardrails: CreatorGuardrails;
  notes: string;
  archived: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type CreatorInput = Omit<
  Creator,
  'id' | 'created_by' | 'created_at' | 'updated_at' | 'is_favorite' | 'script_count' | 'performance'
>;

/** Alias métier : dans l'interface, un « créateur » est présenté comme un *model*. */
export type Model = Creator;

/** Fiche enrichie renvoyée par les listes : compteurs et performance agrégée. */
export interface ModelSummary extends Creator {
  is_favorite: boolean;
  script_count: number;
  performance: ModelPerformance;
}

export interface ModelPerformance {
  usage_count: number;
  conversion_rate: number;
  revenue_cents: number;
  last_used_at: string | null;
  score: number;
}

/* ─────────────────────────  Scénarios  ───────────────────────── */

export type ScenarioCategory =
  | 'first_contact'
  | 'follow_up'
  | 'post_purchase'
  | 'loyalty'
  | 'question'
  | 'reactivation'
  | 'custom';

export interface Scenario {
  id: string;
  key: string;
  name: string;
  category: ScenarioCategory;
  description: string;
  /** Objectif de conversation par défaut proposé dans la console. */
  goal: string;
  /** Étapes attendues du message (structure narrative). */
  beats: string[];
  do_list: string[];
  dont_list: string[];
  suggested_familiarity: Familiarity | null;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export type ScenarioInput = Omit<
  Scenario,
  'id' | 'is_system' | 'created_at' | 'updated_at'
>;

/* ─────────────────────────  Templates  ───────────────────────── */

export interface TemplateVariable {
  name: string;
  label: string;
  description: string;
  default_value: string;
}

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  /** Corps du prompt, avec variables {{...}}. */
  body: string;
  variables: TemplateVariable[];
  scenario_id: string | null;
  creator_id: string | null;
  is_favorite: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type PromptTemplateInput = Omit<
  PromptTemplate,
  'id' | 'created_by' | 'created_at' | 'updated_at'
>;

/* ─────────────────────────  Génération  ───────────────────────── */

export type Familiarity = 'nouveau' | 'occasionnel' | 'regulier' | 'fidele';

export interface GenerationRequest {
  creator_id: string;
  scenario_id?: string | null;
  template_id?: string | null;
  subscriber_alias?: string;
  subscriber_message: string;
  conversation_history: string;
  conversation_context: string;
  objective: string;
  familiarity: Familiarity;
  tone_override?: string;
  extra_instructions?: string;
  /** Prix du contenu proposé, alimente {{price}}. */
  price?: string;
  /** Type de contenu concerné, alimente {{content_type}}. */
  content_type?: string;
  variant_count: number;
}

export type WarningSeverity = 'info' | 'warn' | 'block';

export interface SuggestionWarning {
  code: string;
  severity: WarningSeverity;
  message: string;
}

export interface Suggestion {
  id: string;
  /** Angle éditorial court, ex. « Chaleureux · question ouverte ». */
  label: string;
  text: string;
  rationale: string;
  char_count: number;
  warnings: SuggestionWarning[];
}

export interface GenerationResult {
  id: string;
  creator_id: string;
  scenario_id: string | null;
  template_id: string | null;
  suggestions: Suggestion[];
  /** Avertissements portant sur la demande elle-même (message reçu sensible, etc.). */
  warnings: SuggestionWarning[];
  /** Prompt système effectivement envoyé (traçabilité + debug). */
  system_prompt: string;
  /** Message utilisateur effectivement envoyé. */
  user_prompt: string;
  provider: string;
  model: string;
  latency_ms: number;
  created_at: string;
}

export interface GenerationHistoryItem {
  id: string;
  creator_id: string;
  creator_name: string;
  scenario_id: string | null;
  scenario_name: string | null;
  operator_id: string | null;
  operator_name: string | null;
  subscriber_alias: string | null;
  subscriber_message: string;
  objective: string;
  familiarity: Familiarity;
  suggestions: Suggestion[];
  provider: string;
  model: string;
  latency_ms: number;
  used_suggestion_id: string | null;
  rating: number | null;
  created_at: string;
}

/* ─────────────────────────  Variables dynamiques  ───────────────────────── */

export interface VariableDefinition {
  name: string;
  label: string;
  description: string;
  source: 'creator' | 'scenario' | 'request' | 'system';
  example: string;
}

/* ─────────────────────────  Divers API  ───────────────────────── */

export interface PreviewRequest {
  body: string;
  creator_id?: string | null;
  scenario_id?: string | null;
  request?: Partial<GenerationRequest>;
  overrides?: Record<string, string>;
}

export interface PreviewResult {
  rendered: string;
  used: string[];
  missing: string[];
}

export interface DashboardStats {
  generations_today: number;
  generations_week: number;
  creators_active: number;
  templates_total: number;
  avg_latency_ms: number;
  top_scenarios: { name: string; count: number }[];
  recent: GenerationHistoryItem[];
}

export interface ApiError {
  error: string;
  details?: unknown;
}

/* ═══════════════════════════════════════════════════════════════
 *  Scripts — bibliothèque de messages réutilisables
 *  Un script appartient soit à un modèle (model_id), soit à la
 *  bibliothèque globale (model_id = null).
 * ═══════════════════════════════════════════════════════════════ */

export interface ScriptCategory {
  id: string;
  key: string;
  label: string;
  sort_order: number;
  is_system: boolean;
}

export interface ScriptVariable {
  name: string;
  label: string;
  default_value: string;
}

export interface Script {
  id: string;
  /** null = script global, accessible à tous les modèles. */
  model_id: string | null;
  model_name: string | null;
  category_key: string;
  category_label: string;
  name: string;
  description: string;
  objective: string;
  tone: string;
  /** Déclencheur : dans quelle situation utiliser ce script. */
  trigger: string;
  content: string;
  tags: string[];
  variables: ScriptVariable[];
  /** Favori de l'utilisateur courant. */
  is_favorite: boolean;
  usage_count: number;
  last_used_at: string | null;
  conversion_rate: number;
  revenue_cents: number;
  performance_score: number;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ScriptInput = Pick<
  Script,
  | 'model_id'
  | 'category_key'
  | 'name'
  | 'description'
  | 'objective'
  | 'tone'
  | 'trigger'
  | 'content'
  | 'tags'
  | 'variables'
>;

export interface ScriptFilters {
  model_id?: string | null;
  /** 'all' = scripts du modèle + globaux ; 'global' = globaux seuls ; 'model' = modèle seul. */
  scope?: 'all' | 'global' | 'model';
  category?: string;
  tag?: string;
  search?: string;
  favorites?: boolean;
  recent?: boolean;
  limit?: number;
}

export interface ScriptVersion {
  id: string;
  script_id: string;
  version: number;
  name: string;
  content: string;
  author_name: string | null;
  created_at: string;
}

export interface ScriptUsageInput {
  converted?: boolean;
  revenue_cents?: number;
  note?: string;
}

/* ─────────────────────────  Favoris  ───────────────────────── */

export type FavoriteEntity = 'script' | 'model' | 'generation';

export interface FavoritesBundle {
  scripts: Script[];
  models: ModelSummary[];
  generations: GenerationHistoryItem[];
}

/* ─────────────────────────  Variations de script  ───────────────────────── */

export interface VariationRequest {
  count: number;
  instructions?: string;
}

export interface Variation {
  id: string;
  label: string;
  content: string;
  rationale: string;
  warnings: SuggestionWarning[];
}

/* ─────────────────────────  Analytics  ───────────────────────── */

export interface AnalyticsOverview {
  totals: {
    generations_week: number;
    scripts_total: number;
    scripts_used_week: number;
    revenue_cents: number;
    conversion_rate: number;
  };
  by_day: { date: string; generations: number; usages: number }[];
  top_scripts: Script[];
  by_category: { category: string; usage_count: number; revenue_cents: number }[];
  models: ModelSummary[];
}

/* ─────────────────────────  Recherche globale  ───────────────────────── */

export interface SearchResults {
  models: ModelSummary[];
  scripts: Script[];
  templates: PromptTemplate[];
  generations: GenerationHistoryItem[];
}
