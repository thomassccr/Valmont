-- ════════════════════════════════════════════════════════════
--  Cadence — schéma SQLite
--  Les colonnes suffixées _json contiennent du JSON sérialisé.
-- ════════════════════════════════════════════════════════════

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'operator',
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS creators (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  handle            TEXT NOT NULL DEFAULT '',
  accent_color      TEXT NOT NULL DEFAULT '#7c5cff',
  personality       TEXT NOT NULL DEFAULT '',
  traits_json       TEXT NOT NULL DEFAULT '[]',
  tone              TEXT NOT NULL DEFAULT '',
  interests_json    TEXT NOT NULL DEFAULT '[]',
  writing_style     TEXT NOT NULL DEFAULT '',
  audience_type     TEXT NOT NULL DEFAULT '',
  preferred_topics_json TEXT NOT NULL DEFAULT '[]',
  objectives_json   TEXT NOT NULL DEFAULT '[]',
  lexicon_json      TEXT NOT NULL DEFAULT '{}',
  guardrails_json   TEXT NOT NULL DEFAULT '{}',
  notes             TEXT NOT NULL DEFAULT '',
  archived          INTEGER NOT NULL DEFAULT 0,
  created_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_creators_archived ON creators(archived);

CREATE TABLE IF NOT EXISTS scenarios (
  id           TEXT PRIMARY KEY,
  key          TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  category     TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  goal         TEXT NOT NULL DEFAULT '',
  beats_json   TEXT NOT NULL DEFAULT '[]',
  do_json      TEXT NOT NULL DEFAULT '[]',
  dont_json    TEXT NOT NULL DEFAULT '[]',
  suggested_familiarity TEXT,
  is_system    INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS templates (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  category       TEXT NOT NULL DEFAULT 'Général',
  tags_json      TEXT NOT NULL DEFAULT '[]',
  body           TEXT NOT NULL DEFAULT '',
  variables_json TEXT NOT NULL DEFAULT '[]',
  scenario_id    TEXT REFERENCES scenarios(id) ON DELETE SET NULL,
  creator_id     TEXT REFERENCES creators(id) ON DELETE SET NULL,
  is_favorite    INTEGER NOT NULL DEFAULT 0,
  created_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_templates_category ON templates(category);
CREATE INDEX IF NOT EXISTS idx_templates_scenario ON templates(scenario_id);

CREATE TABLE IF NOT EXISTS generations (
  id                 TEXT PRIMARY KEY,
  creator_id         TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  scenario_id        TEXT REFERENCES scenarios(id) ON DELETE SET NULL,
  template_id        TEXT REFERENCES templates(id) ON DELETE SET NULL,
  operator_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  subscriber_alias   TEXT,
  subscriber_message TEXT NOT NULL DEFAULT '',
  conversation_history TEXT NOT NULL DEFAULT '',
  conversation_context TEXT NOT NULL DEFAULT '',
  objective          TEXT NOT NULL DEFAULT '',
  familiarity        TEXT NOT NULL DEFAULT 'nouveau',
  suggestions_json   TEXT NOT NULL DEFAULT '[]',
  system_prompt      TEXT NOT NULL DEFAULT '',
  user_prompt        TEXT NOT NULL DEFAULT '',
  provider           TEXT NOT NULL DEFAULT '',
  model              TEXT NOT NULL DEFAULT '',
  latency_ms         INTEGER NOT NULL DEFAULT 0,
  used_suggestion_id TEXT,
  rating             INTEGER,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_generations_created ON generations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generations_creator ON generations(creator_id);
CREATE INDEX IF NOT EXISTS idx_generations_operator ON generations(operator_id);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
