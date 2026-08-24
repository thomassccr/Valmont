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
  avatar_url        TEXT NOT NULL DEFAULT '',
  age               INTEGER NOT NULL DEFAULT 0,
  personality       TEXT NOT NULL DEFAULT '',
  traits_json       TEXT NOT NULL DEFAULT '[]',
  tone              TEXT NOT NULL DEFAULT '',
  interests_json    TEXT NOT NULL DEFAULT '[]',
  writing_style     TEXT NOT NULL DEFAULT '',
  audience_type     TEXT NOT NULL DEFAULT '',
  preferred_topics_json TEXT NOT NULL DEFAULT '[]',
  objectives_json   TEXT NOT NULL DEFAULT '[]',
  content_style     TEXT NOT NULL DEFAULT '',
  custom_instructions TEXT NOT NULL DEFAULT '',
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

-- ════════════════════════════════════════════════════════════
--  Bibliothèque de scripts
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS script_categories (
  id         TEXT PRIMARY KEY,
  key        TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 100,
  is_system  INTEGER NOT NULL DEFAULT 0
);

-- model_id NULL = script global, visible par tous les modèles.
CREATE TABLE IF NOT EXISTS scripts (
  id             TEXT PRIMARY KEY,
  model_id       TEXT REFERENCES creators(id) ON DELETE CASCADE,
  category_id    TEXT NOT NULL REFERENCES script_categories(id),
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  objective      TEXT NOT NULL DEFAULT '',
  tone           TEXT NOT NULL DEFAULT '',
  trigger_hint   TEXT NOT NULL DEFAULT '',
  content        TEXT NOT NULL DEFAULT '',
  variables_json TEXT NOT NULL DEFAULT '[]',
  version        INTEGER NOT NULL DEFAULT 1,
  created_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scripts_model ON scripts(model_id);
CREATE INDEX IF NOT EXISTS idx_scripts_category ON scripts(category_id);
CREATE INDEX IF NOT EXISTS idx_scripts_updated ON scripts(updated_at DESC);

CREATE TABLE IF NOT EXISTS script_tags (
  id    TEXT PRIMARY KEY,
  slug  TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS script_tag_links (
  script_id TEXT NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  tag_id    TEXT NOT NULL REFERENCES script_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (script_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_tag_links_tag ON script_tag_links(tag_id);

-- Historique des versions : une ligne par enregistrement modifiant le contenu.
CREATE TABLE IF NOT EXISTS script_versions (
  id         TEXT PRIMARY KEY,
  script_id  TEXT NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  version    INTEGER NOT NULL,
  name       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_versions_script ON script_versions(script_id, version DESC);

-- Une ligne par utilisation réelle d'un script : base des statistiques.
CREATE TABLE IF NOT EXISTS script_usage (
  id            TEXT PRIMARY KEY,
  script_id     TEXT NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  model_id      TEXT REFERENCES creators(id) ON DELETE SET NULL,
  user_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  converted     INTEGER NOT NULL DEFAULT 0,
  revenue_cents INTEGER NOT NULL DEFAULT 0,
  note          TEXT NOT NULL DEFAULT '',
  used_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_script ON script_usage(script_id);
CREATE INDEX IF NOT EXISTS idx_usage_date ON script_usage(used_at DESC);

-- Favoris par utilisateur, tous types d'objets confondus.
CREATE TABLE IF NOT EXISTS favorites (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  UNIQUE (user_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id, entity_type);
