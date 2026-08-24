import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Creator } from '../../../shared/types.js';
import { DEFAULT_GUARDRAILS, DEFAULT_LEXICON } from '../../../shared/defaults.js';
import { analyzeIncomingMessage, validateSuggestion } from './validate.js';
import { buildVariableMap, render } from './variables.js';

const creator: Creator = {
  id: 'crt_test',
  name: 'Lina',
  handle: '@lina',
  accent_color: '#000',
  personality: 'Douce et taquine',
  traits: ['taquine'],
  tone: 'chaleureux',
  interests: ['yoga'],
  writing_style: 'phrases courtes',
  audience_type: 'hommes 30-45',
  preferred_topics: ['sport'],
  objectives: ['créer du lien'],
  lexicon: { ...DEFAULT_LEXICON, banned_words: ['bébé'], emoji_style: 'rare' },
  guardrails: { ...DEFAULT_GUARDRAILS, banned_topics: ['politique'], max_message_chars: 100 },
  notes: '',
  archived: false,
  created_by: null,
  created_at: '',
  updated_at: '',
};

/* ─────────  Rendu des variables  ───────── */

test('render remplace les variables connues', () => {
  const vars = buildVariableMap({
    creator,
    scenario: null,
    request: { subscriber_message: 'coucou', familiarity: 'nouveau', variant_count: 3 },
  });
  const result = render('{{creator_name}} répond à "{{subscriber_message}}"', vars);
  assert.equal(result.rendered, 'Lina répond à "coucou"');
  assert.deepEqual(result.used.sort(), ['creator_name', 'subscriber_message']);
});

test('render retire les variables inconnues et les signale', () => {
  const result = render('Bonjour {{inconnue}}', {});
  assert.equal(result.rendered, 'Bonjour');
  assert.deepEqual(result.missing, ['inconnue']);
});

test('le ton de la console remplace celui du créateur', () => {
  const vars = buildVariableMap({
    creator,
    scenario: null,
    request: { tone_override: 'plus sobre' },
  });
  assert.equal(vars.tone, 'plus sobre');
});

/* ─────────  Validation des suggestions  ───────── */

test('le vocabulaire interdit est bloquant, même accentué ou capitalisé', () => {
  const warnings = validateSuggestion('Coucou Bébé, ça va ?', creator);
  const banned = warnings.find((w) => w.code === 'banned_word');
  assert.ok(banned);
  assert.equal(banned?.severity, 'block');
});

test('un mot interdit inclus dans un autre mot ne déclenche rien', () => {
  const warnings = validateSuggestion('On parle de bébéphone ?', creator);
  assert.equal(
    warnings.find((w) => w.code === 'banned_word'),
    undefined,
  );
});

test('la longueur maximale du créateur est vérifiée', () => {
  const warnings = validateSuggestion('a'.repeat(150), creator);
  assert.ok(warnings.some((w) => w.code === 'too_long'));
});

test('les marqueurs à compléter sont signalés', () => {
  const warnings = validateSuggestion('[À VÉRIFIER : le prénom] à demain', creator);
  assert.ok(warnings.some((w) => w.code === 'placeholder'));
});

test('la pression affective est bloquante', () => {
  const warnings = validateSuggestion('dernière chance, ça part vite', creator);
  const pressure = warnings.find((w) => w.code === 'pressure');
  assert.equal(pressure?.severity, 'block');
});

test('un sujet interdit est bloquant', () => {
  const warnings = validateSuggestion('on parle politique ce soir ?', creator);
  assert.ok(warnings.some((w) => w.code === 'banned_topic' && w.severity === 'block'));
});

/* ─────────  Analyse du message entrant  ───────── */

test('un abonné se déclarant mineur bloque la génération', () => {
  const warnings = analyzeIncomingMessage("salut, j'ai 16 ans et je te suis depuis longtemps");
  const minor = warnings.find((w) => w.code === 'minor_suspected');
  assert.equal(minor?.severity, 'block');
});

test('une question sur l’identité est signalée', () => {
  const warnings = analyzeIncomingMessage("c'est vraiment toi qui réponds ou une équipe ?");
  assert.ok(warnings.some((w) => w.code === 'identity_question'));
});

test('les signaux de détresse financière sont signalés', () => {
  const warnings = analyzeIncomingMessage("je suis endetté, j'ai plus d'argent ce mois-ci");
  assert.ok(warnings.some((w) => w.code === 'distress_signal'));
});

test('un message ordinaire ne déclenche aucun avertissement', () => {
  assert.deepEqual(analyzeIncomingMessage('salut, tu fais quoi ce soir ?'), []);
});
