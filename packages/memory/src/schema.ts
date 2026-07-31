/**
 * Schéma de la mémoire, sous forme de migrations numérotées.
 *
 * Deux règles pour les années à venir :
 *  1. On n'édite **jamais** une migration déjà publiée — on en ajoute une.
 *  2. Le journal `events` est en ajout seul : toutes les autres tables sont
 *     des projections reconstructibles. Si un jour l'extraction change, on
 *     rejoue le journal et la mémoire se reconstruit sans perte.
 */
export const MIGRATIONS: string[] = [
  // ── v1 : socle ────────────────────────────────────────────────────────
  `
  -- Journal d'événements : la source de vérité.
  CREATE TABLE events (
    id        TEXT PRIMARY KEY,
    kind      TEXT NOT NULL,
    at        INTEGER NOT NULL,
    actor     TEXT NOT NULL,
    trace_id  TEXT,
    payload   TEXT NOT NULL
  );
  CREATE INDEX idx_events_at ON events(at);
  CREATE INDEX idx_events_kind_at ON events(kind, at);
  CREATE INDEX idx_events_trace ON events(trace_id);

  CREATE TABLE sessions (
    id            TEXT PRIMARY KEY,
    started_at    INTEGER NOT NULL,
    ended_at      INTEGER,
    channel       TEXT NOT NULL,
    title         TEXT,
    summary       TEXT,
    message_count INTEGER NOT NULL DEFAULT 0,
    mood          REAL,
    motivation    REAL,
    energy        REAL
  );
  CREATE INDEX idx_sessions_started ON sessions(started_at DESC);

  CREATE TABLE messages (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    channel     TEXT NOT NULL,
    tool_calls  TEXT,
    cited       TEXT,
    meta        TEXT
  );
  CREATE INDEX idx_messages_session ON messages(session_id, created_at);
  CREATE INDEX idx_messages_created ON messages(created_at DESC);

  -- Entités : projets, personnes, objectifs, habitudes, idées, décisions…
  CREATE TABLE entities (
    id            TEXT PRIMARY KEY,
    type          TEXT NOT NULL,
    name          TEXT NOT NULL,
    key           TEXT NOT NULL UNIQUE,
    aliases       TEXT NOT NULL DEFAULT '[]',
    description   TEXT,
    status        TEXT NOT NULL DEFAULT 'active',
    attributes    TEXT NOT NULL DEFAULT '{}',
    first_seen_at INTEGER NOT NULL,
    last_seen_at  INTEGER NOT NULL,
    mention_count INTEGER NOT NULL DEFAULT 1,
    salience      REAL NOT NULL DEFAULT 0.5
  );
  CREATE INDEX idx_entities_type ON entities(type, status);
  CREATE INDEX idx_entities_last_seen ON entities(last_seen_at DESC);
  CREATE INDEX idx_entities_salience ON entities(salience DESC);

  CREATE TABLE relations (
    id           TEXT PRIMARY KEY,
    from_id      TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    to_id        TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    predicate    TEXT NOT NULL,
    weight       REAL NOT NULL DEFAULT 1,
    confidence   REAL NOT NULL DEFAULT 0.7,
    created_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    source_memory_id TEXT,
    UNIQUE(from_id, to_id, predicate)
  );
  CREATE INDEX idx_relations_from ON relations(from_id);
  CREATE INDEX idx_relations_to ON relations(to_id);

  -- Souvenirs.
  CREATE TABLE memories (
    id              TEXT PRIMARY KEY,
    kind            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active',
    content         TEXT NOT NULL,
    summary         TEXT,
    subject         TEXT,
    predicate       TEXT,
    object          TEXT,
    importance      REAL NOT NULL DEFAULT 0.5,
    confidence      REAL NOT NULL DEFAULT 0.8,
    valence         REAL NOT NULL DEFAULT 0,
    decay_rate      REAL NOT NULL DEFAULT 1,
    created_at      INTEGER NOT NULL,
    occurred_at     INTEGER,
    last_accessed_at INTEGER NOT NULL,
    access_count    INTEGER NOT NULL DEFAULT 0,
    session_id      TEXT,
    superseded_by   TEXT,
    derived_from    TEXT NOT NULL DEFAULT '[]',
    tags            TEXT NOT NULL DEFAULT '[]'
  );
  CREATE INDEX idx_memories_status_kind ON memories(status, kind);
  CREATE INDEX idx_memories_created ON memories(created_at DESC);
  CREATE INDEX idx_memories_importance ON memories(status, importance DESC);
  -- Détection de contradiction : retrouver instantanément un même (sujet, prédicat).
  CREATE INDEX idx_memories_claim ON memories(subject, predicate) WHERE subject IS NOT NULL;

  -- Recherche plein texte : complète la recherche vectorielle sur les noms
  -- propres et les termes rares, que les embeddings capturent mal.
  CREATE VIRTUAL TABLE memories_fts USING fts5(
    content, summary, content=memories, content_rowid=rowid, tokenize='unicode61'
  );
  CREATE TRIGGER memories_fts_insert AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, content, summary)
    VALUES (new.rowid, new.content, coalesce(new.summary, ''));
  END;
  CREATE TRIGGER memories_fts_delete AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content, summary)
    VALUES ('delete', old.rowid, old.content, coalesce(old.summary, ''));
  END;
  CREATE TRIGGER memories_fts_update AFTER UPDATE OF content, summary ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content, summary)
    VALUES ('delete', old.rowid, old.content, coalesce(old.summary, ''));
    INSERT INTO memories_fts(rowid, content, summary)
    VALUES (new.rowid, new.content, coalesce(new.summary, ''));
  END;

  CREATE TABLE memory_entities (
    memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    role      TEXT,
    PRIMARY KEY (memory_id, entity_id)
  );
  CREATE INDEX idx_memory_entities_entity ON memory_entities(entity_id);

  -- Vecteurs : table dédiée pour ne pas alourdir les lectures de métadonnées.
  CREATE TABLE embeddings (
    owner_kind TEXT NOT NULL,     -- 'memory' | 'entity' | 'theme' | 'chunk'
    owner_id   TEXT NOT NULL,
    model      TEXT NOT NULL,
    dim        INTEGER NOT NULL,
    vector     BLOB NOT NULL,
    PRIMARY KEY (owner_kind, owner_id)
  );

  -- Thèmes émergents.
  CREATE TABLE themes (
    id            TEXT PRIMARY KEY,
    label         TEXT NOT NULL,
    keywords      TEXT NOT NULL DEFAULT '[]',
    first_seen_at INTEGER NOT NULL,
    last_seen_at  INTEGER NOT NULL,
    mention_count INTEGER NOT NULL DEFAULT 1,
    momentum      REAL NOT NULL DEFAULT 0,
    weight        REAL NOT NULL DEFAULT 0
  );
  CREATE TABLE theme_memories (
    theme_id  TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    weight    REAL NOT NULL DEFAULT 1,
    at        INTEGER NOT NULL,
    PRIMARY KEY (theme_id, memory_id)
  );
  CREATE INDEX idx_theme_memories_at ON theme_memories(theme_id, at DESC);

  -- Séries temporelles du tableau de bord.
  CREATE TABLE metrics (
    id         TEXT PRIMARY KEY,
    key        TEXT NOT NULL,
    at         INTEGER NOT NULL,
    day        TEXT NOT NULL,
    value      REAL NOT NULL,
    unit       TEXT,
    source     TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.7,
    meta       TEXT
  );
  CREATE INDEX idx_metrics_key_at ON metrics(key, at DESC);
  CREATE INDEX idx_metrics_day ON metrics(day, key);

  -- Prises de parole spontanées.
  CREATE TABLE initiatives (
    id            TEXT PRIMARY KEY,
    kind          TEXT NOT NULL,
    title         TEXT NOT NULL,
    body          TEXT,
    rationale     TEXT NOT NULL,
    confidence    REAL NOT NULL,
    priority      REAL NOT NULL,
    evidence      TEXT NOT NULL DEFAULT '{}',
    status        TEXT NOT NULL DEFAULT 'pending',
    created_at    INTEGER NOT NULL,
    deliver_after INTEGER,
    expires_at    INTEGER,
    delivered_at  INTEGER,
    resolved_at   INTEGER,
    cooldown_key  TEXT NOT NULL,
    cooldown_days INTEGER NOT NULL DEFAULT 7
  );
  CREATE INDEX idx_initiatives_status ON initiatives(status, priority DESC);
  CREATE INDEX idx_initiatives_cooldown ON initiatives(cooldown_key, delivered_at DESC);

  -- Profil appris (comment il fonctionne, par opposition à ce qu'il a dit).
  CREATE TABLE profile_traits (
    section      TEXT NOT NULL,
    key          TEXT NOT NULL,
    value        TEXT NOT NULL,
    confidence   REAL NOT NULL DEFAULT 0.5,
    observations INTEGER NOT NULL DEFAULT 1,
    evidence     TEXT,
    updated_at   INTEGER NOT NULL,
    PRIMARY KEY (section, key)
  );

  -- Documents et projets indexés depuis le disque.
  CREATE TABLE documents (
    id          TEXT PRIMARY KEY,
    path        TEXT NOT NULL UNIQUE,
    kind        TEXT NOT NULL,
    hash        TEXT NOT NULL,
    mtime       INTEGER NOT NULL,
    size        INTEGER NOT NULL,
    entity_id   TEXT REFERENCES entities(id) ON DELETE SET NULL,
    summary     TEXT,
    indexed_at  INTEGER NOT NULL
  );
  CREATE INDEX idx_documents_entity ON documents(entity_id);

  CREATE TABLE chunks (
    id          TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    ord         INTEGER NOT NULL,
    content     TEXT NOT NULL,
    heading     TEXT
  );
  CREATE INDEX idx_chunks_document ON chunks(document_id, ord);

  -- Clé/valeur interne (dates de dernier passage des tâches, etc.).
  CREATE TABLE kv (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
];
