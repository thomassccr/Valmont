import type { VariableDefinition } from './types.js';

/**
 * Catalogue des variables dynamiques utilisables dans les templates.
 * Le moteur de rendu (server/src/generation/variables.ts) construit une map
 * { nom -> valeur } à partir du créateur, du scénario et de la requête.
 */
export const VARIABLE_CATALOG: VariableDefinition[] = [
  // — Créateur —
  { name: 'creator_name', label: 'Nom du créateur', description: 'Prénom / pseudo utilisé dans la conversation.', source: 'creator', example: 'Lina' },
  { name: 'creator_personality', label: 'Personnalité', description: 'Description libre de la personnalité.', source: 'creator', example: 'Douce, taquine, très à l’écoute' },
  { name: 'creator_traits', label: 'Traits', description: 'Traits de caractère, séparés par des virgules.', source: 'creator', example: 'taquine, bienveillante, curieuse' },
  { name: 'creator_style', label: 'Style d’écriture', description: 'Manière d’écrire : longueur, ponctuation, registre.', source: 'creator', example: 'Phrases courtes, minuscules, peu d’emojis' },
  { name: 'creator_interests', label: 'Centres d’intérêt', description: 'Sujets que le créateur aime aborder.', source: 'creator', example: 'yoga, cinéma coréen, cuisine' },
  { name: 'preferred_topics', label: 'Sujets à privilégier', description: 'Sujets à amener en priorité.', source: 'creator', example: 'sport, routine du soir' },
  { name: 'banned_topics', label: 'Sujets à éviter', description: 'Sujets interdits dans les messages.', source: 'creator', example: 'politique, religion' },
  { name: 'banned_words', label: 'Mots interdits', description: 'Vocabulaire à ne jamais employer.', source: 'creator', example: 'bébé, chéri' },
  { name: 'signature_phrases', label: 'Expressions signature', description: 'Formules typiques du créateur.', source: 'creator', example: 'tu me manques déjà' },
  { name: 'audience_type', label: 'Type d’audience', description: 'Profil dominant des abonnés.', source: 'creator', example: 'hommes 30-45, francophones' },
  { name: 'tone', label: 'Ton', description: 'Ton de communication (surchargé par la console si besoin).', source: 'creator', example: 'chaleureux et complice' },

  // — Scénario —
  { name: 'scenario_name', label: 'Scénario', description: 'Nom du scénario sélectionné.', source: 'scenario', example: 'Première interaction' },
  { name: 'scenario_goal', label: 'But du scénario', description: 'Résultat attendu de l’échange.', source: 'scenario', example: 'Créer un premier lien et faire parler l’abonné' },
  { name: 'scenario_beats', label: 'Étapes du scénario', description: 'Structure narrative attendue du message.', source: 'scenario', example: 'accroche · question ouverte · relance douce' },

  // — Requête —
  { name: 'subscriber_message', label: 'Message reçu', description: 'Dernier message de l’abonné.', source: 'request', example: 'salut, tu fais quoi ce soir ?' },
  { name: 'conversation_history', label: 'Historique récent', description: 'Derniers échanges, du plus ancien au plus récent.', source: 'request', example: 'Abonné : hello\nCréateur : coucou toi' },
  { name: 'conversation_context', label: 'Contexte', description: 'Notes libres de l’opérateur sur la situation.', source: 'request', example: 'Il vient de rater le live d’hier' },
  { name: 'objective', label: 'Objectif', description: 'Objectif commercial ou relationnel du message.', source: 'request', example: 'Proposer le pack photo sans insister' },
  { name: 'familiarity', label: 'Familiarité', description: 'Niveau de proximité avec l’abonné.', source: 'request', example: 'régulier' },
  { name: 'subscriber_alias', label: 'Abonné', description: 'Pseudo ou alias de l’abonné.', source: 'request', example: 'marc_92' },
  { name: 'extra_instructions', label: 'Consignes additionnelles', description: 'Consigne ponctuelle de l’opérateur.', source: 'request', example: 'Rester très court' },
  { name: 'variant_count', label: 'Nombre de variantes', description: 'Nombre de suggestions demandées.', source: 'request', example: '3' },

  // — Système —
  { name: 'operator_name', label: 'Opérateur', description: 'Nom de l’opérateur connecté.', source: 'system', example: 'Sarah' },
  { name: 'date', label: 'Date', description: 'Date du jour (ISO).', source: 'system', example: '2026-08-24' },
  { name: 'max_message_chars', label: 'Longueur max', description: 'Longueur maximale autorisée pour un message.', source: 'system', example: '400' },
];

export const VARIABLE_NAMES = VARIABLE_CATALOG.map((v) => v.name);

/** Repère toutes les occurrences {{variable}} d'un texte. */
export function extractVariables(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)) {
    found.add(match[1].toLowerCase());
  }
  return [...found];
}
