import type { Creator, SuggestionWarning } from '../../../shared/types.js';

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

const EMOJI = /\p{Extended_Pictographic}/gu;

const containsWord = (haystack: string, needle: string): boolean => {
  const escaped = normalize(needle).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!escaped) return false;
  return new RegExp(`(^|[^\\p{L}])${escaped}([^\\p{L}]|$)`, 'iu').test(haystack);
};

const warn = (
  code: string,
  severity: SuggestionWarning['severity'],
  message: string,
): SuggestionWarning => ({ code, severity, message });

/* ─────────────────  Analyse du message entrant  ───────────────── */

const MINOR_PATTERNS = [/\b(j'?ai|jai)\s?(1[0-7]|[1-9])\s?ans\b/i, /\bmineur\b/i, /\bcolle?ge\b/i, /\blyceen\b/i];
const DISTRESS_PATTERNS = [
  /\b(depress|suicid|envie de mourir|mal dans ma peau|je n'?en peux plus)/i,
  /\b(addict|dependan|je depense trop|j'?ai plus d'?argent|je suis endett|ruine)/i,
  /\b(divorce|licencie|au chomage|hopital|malade grave)/i,
];
const IDENTITY_PATTERNS = [
  /\b(c'?est (vraiment|bien) toi)\b/i,
  /\b(tu es|t'?es) (un |une )?(bot|robot|ia|chatter|assistant)/i,
  /\b(quelqu'?un d'?autre|une equipe|un employe) (qui )?(ecrit|repond|gere)/i,
  /\b(c'?est ton (agence|equipe|manager))\b/i,
];
const OFF_PLATFORM_PATTERNS = [
  /\b(whats ?app|telegram|snap ?chat|signal|discord)\b/i,
  /\b(paypal|virement|revolut|crypto|cash ?app)\b/i,
  /\b(ton (numero|adresse)|mon numero)\b/i,
];

/**
 * Analyse le message reçu AVANT la génération.
 * Un avertissement `block` empêche la génération : l'opérateur doit escalader.
 */
export function analyzeIncomingMessage(message: string): SuggestionWarning[] {
  const text = normalize(message);
  const found: SuggestionWarning[] = [];

  if (MINOR_PATTERNS.some((p) => p.test(text))) {
    found.push(
      warn(
        'minor_suspected',
        'block',
        "Le message suggère que l'abonné pourrait être mineur. Aucune suggestion n'est générée : escalade immédiate vers un responsable.",
      ),
    );
  }
  if (DISTRESS_PATTERNS.some((p) => p.test(text))) {
    found.push(
      warn(
        'distress_signal',
        'warn',
        "Signaux de détresse ou de difficulté financière détectés. Aucune relance commerciale ne sera proposée : privilégier une réponse humaine et prévenir un responsable.",
      ),
    );
  }
  if (IDENTITY_PATTERNS.some((p) => p.test(text))) {
    found.push(
      warn(
        'identity_question',
        'warn',
        "L'abonné interroge l'identité de son interlocuteur. Ne pas démentir : répondre honnêtement ou escalader selon la procédure de l'agence.",
      ),
    );
  }
  if (OFF_PLATFORM_PATTERNS.some((p) => p.test(text))) {
    found.push(
      warn(
        'off_platform',
        'warn',
        "Demande de contact ou de paiement hors plateforme. Les suggestions ne doivent pas y donner suite.",
      ),
    );
  }
  return found;
}

/* ─────────────────  Validation d'une suggestion  ───────────────── */

const PROMISE_PATTERNS: [RegExp, string][] = [
  [/\b(je (te )?promets|promis|je te jure|c'?est sur|garanti)\b/i, 'promesse explicite'],
  [/\b(demain|ce soir|dans \d+ (minutes|heures|jours)|a \d{1,2}h)\b/i, 'engagement de délai'],
  [/\b(\d+\s?(euros?|€|\$|dollars?)|gratuit|offert|remise|reduction)\b/i, 'mention de prix ou de gratuité'],
  [/\b(je (t')?(envoie|envoi|prepare|fais)\b.{0,25}\b(photo|video|contenu|pack))/i, 'promesse de contenu'],
];

const PERSONAL_FACT_PATTERNS: [RegExp, string][] = [
  [/\b(j'?habite|je vis (a|en)|je suis (a|en) [A-ZÀ-Ý])/i, 'localisation'],
  [/\b(j'?ai \d{2} ans)\b/i, 'âge'],
  [/\b(mon (copain|mari|fils|fille|frere|soeur|patron))\b/i, 'entourage'],
];

const PRESSURE_PATTERNS: [RegExp, string][] = [
  [/\b(derniere chance|plus que \d+|ca part vite|depeche|vite avant)\b/i, 'urgence artificielle'],
  [/\b(tu m'?oublies|tu ne m'?aimes plus|ca me blesse|tu me deçois)\b/i, 'culpabilisation'],
];

export function validateSuggestion(text: string, creator: Creator): SuggestionWarning[] {
  const normalized = normalize(text);
  const found: SuggestionWarning[] = [];
  const { lexicon, guardrails } = creator;

  if (text.length > guardrails.max_message_chars) {
    found.push(
      warn(
        'too_long',
        'warn',
        `${text.length} caractères pour un maximum de ${guardrails.max_message_chars}.`,
      ),
    );
  }

  const bannedWords = lexicon.banned_words.filter((word) => containsWord(normalized, word));
  if (bannedWords.length) {
    found.push(
      warn('banned_word', 'block', `Vocabulaire interdit employé : ${bannedWords.join(', ')}.`),
    );
  }

  const bannedTopics = guardrails.banned_topics.filter((topic) => containsWord(normalized, topic));
  if (bannedTopics.length) {
    found.push(warn('banned_topic', 'block', `Sujet interdit abordé : ${bannedTopics.join(', ')}.`));
  }

  if (/\{\{|\}\}|\[\s*(À|A)\s*V(É|E)RIFIER/i.test(text)) {
    found.push(
      warn('placeholder', 'warn', "La suggestion contient un marqueur à compléter avant envoi."),
    );
  }

  const emojiCount = (text.match(EMOJI) ?? []).length;
  const emojiLimit = { aucun: 0, rare: 1, modere: 2, intensif: 6 }[lexicon.emoji_style];
  if (emojiCount > emojiLimit) {
    found.push(
      warn(
        'emoji_style',
        'info',
        `${emojiCount} emojis alors que le style « ${lexicon.emoji_style} » en tolère ${emojiLimit}.`,
      ),
    );
  }

  if (guardrails.no_promises) {
    for (const [pattern, label] of PROMISE_PATTERNS) {
      if (pattern.test(normalized)) {
        found.push(warn('promise', 'warn', `À vérifier avant envoi — ${label} détectée.`));
        break;
      }
    }
  }

  if (guardrails.no_personal_facts) {
    for (const [pattern, label] of PERSONAL_FACT_PATTERNS) {
      if (pattern.test(normalized)) {
        found.push(warn('personal_fact', 'warn', `Affirmation personnelle à confirmer — ${label}.`));
        break;
      }
    }
  }

  for (const [pattern, label] of PRESSURE_PATTERNS) {
    if (pattern.test(normalized)) {
      found.push(warn('pressure', 'block', `Formulation de pression détectée — ${label}.`));
      break;
    }
  }

  return found;
}

export const hasBlocking = (warnings: SuggestionWarning[]): boolean =>
  warnings.some((w) => w.severity === 'block');
