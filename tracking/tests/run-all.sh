#!/usr/bin/env bash
# Lance toute la suite de tests du module Tracking Links.
#
#   ./tracking/tests/run-all.sh                  # tests Worker + interface
#   PGURL=postgres://… ./tracking/tests/run-all.sh   # + tests base de données
#
# Les tests base de données créent leurs objets dans la base pointée par PGURL :
# utilise une base jetable, jamais la production.
set -euo pipefail
cd "$(dirname "$0")/../.."

if [ -n "${PGURL:-}" ]; then
  echo "── Base de données ──────────────────────────────"
  psql "$PGURL" -v ON_ERROR_STOP=1 -q -f tracking/tests/00-harness.sql
  psql "$PGURL" -v ON_ERROR_STOP=1 -q -f tracking/schema.sql
  psql "$PGURL" -v ON_ERROR_STOP=1 -f tracking/tests/01-fonctionnel.sql
  psql "$PGURL" -v ON_ERROR_STOP=1 -f tracking/tests/02-securite-rls.sql
else
  echo "PGURL non défini → tests base de données ignorés."
fi

echo "── Worker de redirection ────────────────────────"
node tracking/tests/03-worker.test.mjs
echo "── Interface ────────────────────────────────────"
node tracking/tests/04-ui.test.mjs
echo "── Mode cloud ───────────────────────────────────"
node tracking/tests/05-cloud.test.mjs
echo "── Non-régression de l'application ──────────────"
node tracking/tests/06-non-regression.test.mjs
