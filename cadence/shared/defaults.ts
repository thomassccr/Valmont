import type { CreatorGuardrails, CreatorLexicon } from './types.js';

export const DEFAULT_LEXICON: CreatorLexicon = {
  language: 'fr',
  preferred_words: [],
  banned_words: [],
  signature_phrases: [],
  favorite_emojis: [],
  emoji_style: 'rare',
  punctuation: 'standard',
  capitalization: 'standard',
  typical_message_length: 'court',
};

export const DEFAULT_GUARDRAILS: CreatorGuardrails = {
  banned_topics: [],
  hard_rules: [],
  no_promises: true,
  no_personal_facts: true,
  max_message_chars: 420,
};
