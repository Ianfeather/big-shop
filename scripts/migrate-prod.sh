#!/usr/bin/env bash
# Apply the pending files in migrations/ to the production database.
#
# Run by .github/workflows/deploy-api.yml immediately before `flyctl deploy`,
# and runnable from a laptop for the same effect.
#
# ---------------------------------------------------------------------------
# Why this runs before the deploy and not after
# ---------------------------------------------------------------------------
# The failure it exists to prevent is new code meeting an old schema. On
# 2026-08-27 #133 shipped a `SELECT ... featured` that migration 042 had not yet
# added the column for, and every GET /recipe/{id} answered 500 until the
# migration was applied by hand the next day. Migrating first means the schema
# is never behind the code.
#
# The cost of that order is the mirror image: between this step and the release
# taking effect, the *old* code is running against the *new* schema. That is
# fine for an additive migration - a column nothing reads yet - and is not fine
# for one that drops or renames something the running code still uses. So:
# **additive migrations deploy in one step; a destructive change is two
# releases** - ship the code that stops using the column, then the migration
# that removes it. There is nothing here that can enforce that, which is why it
# is written down.
#
# ---------------------------------------------------------------------------
# Where the password comes from, and why that differs from its siblings
# ---------------------------------------------------------------------------
# scripts/lib/tidb-env.sh states that the password "is never read from the
# environment or from a file" - it is typed, on every run, by a person. That
# posture is right for backup-prod.sh, check-orphans.sh and sync-from-prod.sh,
# which a human invokes.
#
# It cannot hold for a step inside a deploy, which is the whole point of the
# step: a migration that waits for someone to type something is a migration
# that gets applied a day late, which is precisely the incident above. So this
# reads TIDB_PASSWORD from the environment - in CI, from the repository secret
# of the same name - and prompts only when it is unset and someone is watching.
set -euo pipefail
cd "$(dirname "$0")/.."

. "$(dirname "$0")/lib/tidb-env.sh"
tidb_env_load

if [ -z "${TIDB_PASSWORD:-}" ]; then
  if [ -t 0 ]; then
    read -rsp "TiDB password for ${TIDB_USER}@${TIDB_HOST}: " TIDB_PASSWORD
    echo
  fi
  if [ -z "${TIDB_PASSWORD:-}" ]; then
    echo "TIDB_PASSWORD is not set." >&2
    echo >&2
    echo "In CI it comes from the repository secret of the same name; the deploy" >&2
    echo "workflow passes it to this script. Interactively, run this from a" >&2
    echo "terminal and it will prompt." >&2
    exit 1
  fi
fi
export TIDB_PASSWORD

# TiDB Cloud requires TLS. Stated here rather than inferred from the hostname
# for the reason dsn.go gives: guessing means that the day the host stops
# looking like TiDB Cloud, the connection quietly stops being encrypted.
export TIDB_TLS=true

echo "Applying pending migrations to ${TIDB_DB} on ${TIDB_HOST}..."
cd netlify-functions/recipes
exec go run . migrate "$@"
