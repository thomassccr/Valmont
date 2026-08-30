-- =====================================================================
-- Schéma de la base locale du simulateur.
--
-- Quatre tables suffisent à reproduire la mécanique d'un panel :
--   fake_users    : le stock de faux comptes du « fournisseur »
--   orders        : les commandes passées par le client
--   deliveries    : le lien faux compte <-> commande (le cœur du système)
--   order_events  : le journal lisible de tout ce qui s'est passé
-- =====================================================================

-- Le stock de faux comptes. Aucun de ces comptes n'existe : ce sont des
-- chaînes de caractères générées localement.
CREATE TABLE IF NOT EXISTS fake_users (
  id          INTEGER PRIMARY KEY,
  username    TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  avatar_seed TEXT NOT NULL,      -- sert à dessiner un avatar déterministe côté UI
  quality     TEXT NOT NULL,      -- bot | inactif | ancien
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fake_users_quality ON fake_users(quality);

-- Une commande = ce que le client demande au fournisseur.
CREATE TABLE IF NOT EXISTS orders (
  order_id     INTEGER PRIMARY KEY,
  target       TEXT NOT NULL,      -- le pseudo ciblé (fictif lui aussi)
  quantity     INTEGER NOT NULL,
  delivered    INTEGER NOT NULL DEFAULT 0,  -- abonnés actuellement actifs
  dropped      INTEGER NOT NULL DEFAULT 0,  -- abonnés livrés puis disparus
  refilled     INTEGER NOT NULL DEFAULT 0,  -- abonnés livrés en remplacement
  status       TEXT NOT NULL,               -- pending | processing | completed | cancelled
  speed        TEXT NOT NULL,               -- clé d'un profil de CONFIG.vitesses
  drop_rate    REAL NOT NULL DEFAULT 0,     -- 0 -> 1, propension à la chute
  auto_refill  INTEGER NOT NULL DEFAULT 0,  -- 1 = garantie de remplacement
  created_at   TEXT NOT NULL,
  start_after  TEXT NOT NULL,               -- fin de la file d'attente (pending -> processing)
  resume_after TEXT,                        -- utilisé pour temporiser un refill
  started_at   TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);

-- Le lien entre un faux compte et une commande.
-- C'est ici que se joue toute la mécanique :
--   'queued'  -> le compte est réservé dans le stock pour cette commande
--   'active'  -> le compte a été « livré »
--   'dropped' -> le compte a disparu (chute)
CREATE TABLE IF NOT EXISTS deliveries (
  id           INTEGER PRIMARY KEY,
  order_id     INTEGER NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  fake_user_id INTEGER NOT NULL REFERENCES fake_users(id),
  state        TEXT NOT NULL,
  is_refill    INTEGER NOT NULL DEFAULT 0,
  delivered_at TEXT,
  dropped_at   TEXT,
  UNIQUE(order_id, fake_user_id)
);

CREATE INDEX IF NOT EXISTS idx_deliveries_order_state ON deliveries(order_id, state);

-- Journal pédagogique : chaque étape importante y laisse une trace lisible.
CREATE TABLE IF NOT EXISTS order_events (
  id         INTEGER PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  type       TEXT NOT NULL,   -- created | queued | started | progress | drop | refill | completed | cancelled
  message    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_order ON order_events(order_id, id DESC);
