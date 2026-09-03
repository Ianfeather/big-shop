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

# Default to the migration account rather than to .env.tidb's TIDB_USER.
#
# That file names root, because the other scripts sharing it dump the database
# and alter charsets. Applying a migration needs none of that - the deploy has
# used the narrower `gh_migrate` account since #148 - but this script kept
# inheriting root, so a human running `--dry-run` to rehearse the deploy was
# rehearsing the wrong credential. It passed, and proved nothing: the whole
# point of that rehearsal is to establish that the narrow grant is sufficient,
# and root is sufficient for anything.
#
# An explicitly exported TIDB_USER still wins, which is what the deploy
# workflow passes and what a one-off run as another account would set. The
# capture that makes that distinction possible now lives in tidb-env.sh, which
# is sourced above; the three read-only scripts ask for TIDB_READONLY_USER
# through the same function.
tidb_env_prefer_user TIDB_MIGRATE_USER

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

# ---------------------------------------------------------------------------
# Why this runs in a container
# ---------------------------------------------------------------------------
# Because the machine running it usually has no Go. The other scripts that talk
# to production - backup-prod.sh, check-orphans.sh, sync-from-prod.sh - all run
# `mysql` in a pinned container for exactly this reason, and this is the same
# problem with a different tool. A plain `docker run`, not `docker compose run`:
# compose would resolve to whichever project the working directory implies
# (every worktree here is called big-shop - see CLAUDE.md) and would start the
# local `db` service this has no use for. A production migration must not be
# able to touch a development database by accident.
#
# It also fixes what a host toolchain cannot promise: that the Go applying the
# migration is the Go the code was written for. GO_IMAGE tracks the Dockerfile's
# build stage; go.mod's `go 1.25.0` and ci.yml's setup-go are the other two
# places this version is stated, and all four move together.
GO_IMAGE="golang:1.25-bookworm"

# The repo goes in read-only. Nothing in `go run . migrate` writes to the tree -
# builds land in GOCACHE and downloads in GOMODCACHE, both named volumes below -
# so mounting it :ro costs nothing and means a container running as root cannot
# leave root-owned files in someone's checkout.
#
# The two caches are named volumes rather than throwaway layers so that a second
# run does not re-download the module graph. They are the only state this keeps.
run_migrate_in_container() {
  docker run --rm -i \
    -v "$PWD:/src:ro" \
    -v bigshop-go-mod-cache:/go/pkg/mod \
    -v bigshop-go-build-cache:/root/.cache/go-build \
    -w /src/netlify-functions/recipes \
    -e TIDB_HOST -e TIDB_PORT -e TIDB_USER -e TIDB_DB -e TIDB_TLS \
    -e TIDB_PASSWORD \
    "$GO_IMAGE" \
    go run . migrate "$@"
}

# `-e NAME` without a value, deliberately: docker takes the value from this
# shell's environment instead of from the command line, so the password never
# appears in `ps` output or in a shell history. `-e NAME=value` would put it in
# both.

echo "Applying pending migrations to ${TIDB_DB} on ${TIDB_HOST}..."

# MIGRATE_GO=host skips the container and uses whatever `go` is on PATH.
#
# Set by the deploy workflow, which has already installed the pinned version
# through actions/setup-go: pulling a ~350MB image to duplicate that would add a
# minute to every deploy and put Docker Hub's availability on the production
# deploy path, which is a new way for a deploy to fail and buys nothing.
# Locally the container is the default, because locally there is usually no Go
# at all.
if [ "${MIGRATE_GO:-container}" = host ]; then
  cd netlify-functions/recipes
  exec go run . migrate "$@"
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running, and it is how this script gets a Go toolchain." >&2
  echo "Start Docker, or re-run with MIGRATE_GO=host if you have Go ${GO_IMAGE#golang:} installed." >&2
  exit 1
fi

run_migrate_in_container "$@"
