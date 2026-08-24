import { z } from 'zod';

const strArray = z.array(z.string().trim().min(1)).max(50).default([]);

export const lexiconSchema = z.object({
  language: z.string().default('fr'),
  preferred_words: strArray,
  banned_words: strArray,
  signature_phrases: strArray,
  favorite_emojis: strArray,
  emoji_style: z.enum(['aucun', 'rare', 'modere', 'intensif']).default('rare'),
  punctuation: z.enum(['sobre', 'standard', 'expressive']).default('standard'),
  capitalization: z.enum(['minuscules', 'standard']).default('standard'),
  typical_message_length: z.enum(['court', 'moyen', 'long']).default('court'),
});

export const guardrailsSchema = z.object({
  banned_topics: strArray,
  hard_rules: strArray,
  no_promises: z.boolean().default(true),
  no_personal_facts: z.boolean().default(true),
  max_message_chars: z.number().int().min(80).max(2000).default(420),
});

export const creatorSchema = z.object({
  name: z.string().trim().min(1, 'Le nom est obligatoire').max(80),
  handle: z.string().trim().max(80).default(''),
  accent_color: z.string().trim().max(20).default('#7c5cff'),
  personality: z.string().max(2000).default(''),
  traits: strArray,
  tone: z.string().max(500).default(''),
  interests: strArray,
  writing_style: z.string().max(2000).default(''),
  audience_type: z.string().max(500).default(''),
  preferred_topics: strArray,
  objectives: strArray,
  lexicon: lexiconSchema.partial().default({}),
  guardrails: guardrailsSchema.partial().default({}),
  notes: z.string().max(4000).default(''),
  archived: z.boolean().default(false),
});

export const scenarioSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9_-]+$/i, 'Clé alphanumérique uniquement'),
  name: z.string().trim().min(1).max(80),
  category: z.enum([
    'first_contact',
    'follow_up',
    'post_purchase',
    'loyalty',
    'question',
    'reactivation',
    'custom',
  ]),
  description: z.string().max(1000).default(''),
  goal: z.string().max(500).default(''),
  beats: strArray,
  do_list: strArray,
  dont_list: strArray,
  suggested_familiarity: z
    .enum(['nouveau', 'occasionnel', 'regulier', 'fidele'])
    .nullable()
    .default(null),
});

export const templateVariableSchema = z.object({
  name: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]+$/i, 'Nom de variable invalide'),
  label: z.string().trim().max(80).default(''),
  description: z.string().max(300).default(''),
  default_value: z.string().max(1000).default(''),
});

export const templateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1000).default(''),
  category: z.string().trim().max(60).default('Général'),
  tags: strArray,
  body: z.string().max(20_000).default(''),
  variables: z.array(templateVariableSchema).max(40).default([]),
  scenario_id: z.string().nullable().default(null),
  creator_id: z.string().nullable().default(null),
  is_favorite: z.boolean().default(false),
});

export const generationSchema = z.object({
  creator_id: z.string().min(1),
  scenario_id: z.string().nullable().optional(),
  template_id: z.string().nullable().optional(),
  subscriber_alias: z.string().trim().max(80).optional(),
  subscriber_message: z.string().max(8000).default(''),
  conversation_history: z.string().max(20_000).default(''),
  conversation_context: z.string().max(4000).default(''),
  objective: z.string().max(500).default(''),
  familiarity: z.enum(['nouveau', 'occasionnel', 'regulier', 'fidele']).default('nouveau'),
  tone_override: z.string().max(300).optional(),
  extra_instructions: z.string().max(1000).optional(),
  variant_count: z.number().int().min(1).max(5).default(3),
});

export const previewSchema = z.object({
  body: z.string().max(20_000),
  creator_id: z.string().nullable().optional(),
  scenario_id: z.string().nullable().optional(),
  request: generationSchema.partial().optional(),
  overrides: z.record(z.string(), z.string()).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().email('Email invalide'),
  password: z.string().min(1, 'Mot de passe requis'),
});

export const userSchema = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().min(1).max(80),
  password: z.string().min(8, 'Au moins 8 caractères'),
  role: z.enum(['admin', 'operator']).default('operator'),
});

export const feedbackSchema = z.object({
  used_suggestion_id: z.string().nullable().optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
});
