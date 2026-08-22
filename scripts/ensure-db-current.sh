#!/usr/bin/env bash
# Make the local dev database's schema match migrations/, repairing it if not.
#
# Called by scripts/dev-full.sh before the API comes up, and by
# scripts/sync-from-prod.sh before it imports. Safe and near-instant to run at
# any time: on the normal path it is one SELECT and it prints nothing.
#
# ---------------------------------------------------------------------------
# The problem this exists for
# ---------------------------------------------------------------------------
# MySQL only runs docker-entrypoint-initdb.d when the data directory is empty.
# So docker/mysql-init/01-migrate-and-seed.sh - the replay, the reconciliation
# against expected-migration-errors.txt, the verdict in _migration_status -
# runs exactly ONCE in a volume's life, on creation.
#
# That makes it structurally incapable of catching a volume that has fallen
# behind: the check does not run, precisely because the volume is stale.
# `ok = 1` is a statement about the day the volume was created and it stays 1
# forever. Add a migration and every existing volume is silently behind, with a
# green healthcheck asserting the opposite. The symptom is not a schema error -
# it is a 500 from an endpoint touching the missing table, which reads exactly
# like an application bug. That is how it was found (a worktree volume four
# days old missing `consent_event` and `email_send`, so GET /user 500'd and
# every account-scoped page rendered empty).
#
# ---------------------------------------------------------------------------
# Why this repairs rather than reports
# ---------------------------------------------------------------------------
# The obvious fix is to detect the drift and tell the developer to run
# `docker compose down -v`. That is discipline with a reminder bolted on: the
# human still does the work and still loses their data.
#
# It is avoidable because **the dev database volume is a cache, not a store of
# record.** Everything in it is reconstructible from three things that live
# outside it: migrations/*.sql, docker/mysql-seed/dev-seed.sql, and a dump
# taken on the host. So this script dumps the volume's data out of the running
# container (no password, no network - it is talking to a local container as
# root), destroys the volume, lets the existing init path replay and seed, and
# puts the data back.
#
# Note that scripts/sync-from-prod.sh already took this view: it truncates
# eight tables and reimports on every run, saves a replayable dump to
# docker/prod-dumps/, and passes --no-create-info --complete-insert precisely
# so prod's data can land in a *local* schema that is ahead of production. It
# assumes the local schema is current, which means a stale volume does not only
# break `npm run dev:full` - it breaks the sync script too. Hence the call from
# there as well.
#
# ---------------------------------------------------------------------------
# What this does NOT do
# ---------------------------------------------------------------------------
# Apply the missing migrations to the live volume. That needs a real migration
# runner with idempotency and ordering guarantees, and these migrations are not
# written to be re-runnable - expected-migration-errors.txt exists because they
# are replayed wholesale against an empty schema.
#
# One honest limit of restoring instead: the restore reproduces the *state* of
# the local data, not its *history*. That is fine for a DDL migration. It is
# not fine for a data-fixup migration (022, 023, 029_merge_duplicate_ingredients,
# 031_backfill_recipe_method are all of this kind), where putting the old rows
# back on top can reinstate exactly what the new migration removed. Production
# has had that migration applied properly, so the escape hatch is
# scripts/sync-from-prod.sh - and this script says so when it sees one coming.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd -P)"

DUMP_DIR="docker/prod-dumps"

# MYSQL_PWD rather than -p on the argv, for the reason sync-from-prod.sh gives:
# mysql emits "[Warning] Using a password on the command line interface can be
# insecure." on stderr for every invocation, and this script captures stderr to
# report a failed restore - so the warning would appear inside the error message
# as though it were part of the problem.
mysql_in_db() {
  docker compose exec -T -e MYSQL_PWD=root db mysql -h 127.0.0.1 -uroot "$@"
}

# ---------------------------------------------------------------------------
# 1. Get the db container up and answering, but do NOT wait for healthy.
# ---------------------------------------------------------------------------
# Healthy is exactly what a stale volume is not - docker-compose.yml's
# healthcheck now fails on drift - so waiting for it here would deadlock on the
# condition this script exists to clear. A plain ping is the right readiness
# signal, and -h 127.0.0.1 (not "localhost") for the reason the healthcheck
# comment gives at length: "localhost" means the Unix socket, which the
# temporary --skip-networking mysqld used during init also binds.
# Output captured rather than discarded: compose writes its progress lines to
# stderr, and on the normal path this script must print nothing at all. A real
# failure here still needs to be seen.
if ! compose_up_output="$(docker compose up -d db 2>&1)"; then
  echo "$compose_up_output" >&2
  exit 1
fi

# Generous, because on a fresh volume this wait *is* the migration replay: the
# TCP ping only succeeds once the real networked mysqld is up, which is after
# docker-entrypoint-initdb.d has finished. ~12s on a laptop, and a CI runner is
# the place where a too-tight bound would fail for no reason.
for _ in $(seq 1 180); do
  if docker compose exec -T -e MYSQL_PWD=root db mysqladmin ping -h 127.0.0.1 -uroot --silent >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! docker compose exec -T -e MYSQL_PWD=root db mysqladmin ping -h 127.0.0.1 -uroot --silent >/dev/null 2>&1; then
  echo "The db container did not become reachable - check 'docker compose logs db'." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Refuse to touch a container belonging to a different worktree.
# ---------------------------------------------------------------------------
# This script destroys a volume, unattended. Compose derives its project name
# from the directory basename, and every worktree of this repo is checked out
# into a directory called `big-shop` - so a bare `docker compose` from worktree
# B can silently resolve to worktree A's already-running containers (CLAUDE.md
# documents this at length for the dev stack). Automating a destructive command
# that can land on the wrong stack is worse than the bug it fixes.
#
# The bind mount is the reliable discriminator: whichever project we resolved
# to, `/migrations` in that container points at the source tree that started
# it. If it is not this one, stop.
CID="$(docker compose ps -q db)"
MOUNTED_MIGRATIONS="$(docker inspect "$CID" \
  --format '{{range .Mounts}}{{if eq .Destination "/migrations"}}{{.Source}}{{end}}{{end}}')"

# Docker Desktop does not report the host path the daemon was given. It reports
# the path as seen from inside its own Linux VM, where the host filesystem is
# mounted under a fixed prefix - `/host_mnt` on macOS, `/run/desktop/mnt/host`
# on Windows. So on a Mac this comes back as
# /host_mnt/Users/you/…/big-shop/migrations and a plain string comparison
# against the host path fails on every single run.
#
# Stripping the known prefixes rather than suffix-matching is deliberate: a
# suffix match would accept /host_mnt/other/place/big-shop/migrations for a
# worktree at /place/big-shop, which is exactly the confusion this guard exists
# to prevent. An unknown prefix is left in place and correctly refused.
CONTAINER_MIGRATIONS="${MOUNTED_MIGRATIONS#/host_mnt}"
CONTAINER_MIGRATIONS="${CONTAINER_MIGRATIONS#/run/desktop/mnt/host}"

if [ "$CONTAINER_MIGRATIONS" != "$REPO_ROOT/migrations" ]; then
  cat >&2 <<MSG

Refusing to continue: the running \`db\` container is not this worktree's.

  this worktree : $REPO_ROOT/migrations
  the container : ${MOUNTED_MIGRATIONS:-<no /migrations mount>}

Compose resolved to another checkout's project, because it names projects after
the directory basename and every worktree here is called \`big-shop\`. This
script would have destroyed that database. Give this worktree its own project:

    COMPOSE_PROJECT_NAME=bigshop-$(basename "$(dirname "$REPO_ROOT")") \\
      DB_PORT=3309 API_PORT=8081 npm run dev:full

MSG
  exit 1
fi

# ---------------------------------------------------------------------------
# 3. Compare the recorded migration set against the repo.
# ---------------------------------------------------------------------------
# The '@' round trip keeps the whole set in one batch-mode field: mysql's -B
# output escapes a real newline to a literal \n, which would then have to be
# un-escaped here. A migration filename cannot contain '@' (they are all
# NNN_lower_snake.sql), so nothing is ambiguous. The same substitution is on the
# writing side in 01-migrate-and-seed.sh and in the healthcheck.
recorded_raw="$(mysql_in_db -N -B -e \
  "SELECT REPLACE(applied, CHAR(10), '@') FROM bigshop._migration_status WHERE id = 1" \
  2>/dev/null || true)"

# Three ways this can be empty, all meaning the same thing: no _migration_status
# table (a volume predating the whole verdict mechanism), no `applied` column (a
# volume predating this script), or a NULL value. All are treated as stale,
# unconditionally.
#
# That is a deliberate reversal of the precedent in docker-compose.yml comment
# 3, which fell back to a plain ping when _migration_status was absent, to avoid
# turning every existing developer's database unhealthy on upgrade - the cost
# being a `down -v` that "throws away a synced copy of production". That cost is
# what has just gone away: the rebuild below is lossless in the normal case. An
# unrecorded volume is also precisely the volume most likely to be stale, so
# treating it as current was blind in exactly the wrong place.
RECORDED="$(mktemp)"
EXPECTED="$(mktemp)"
trap 'rm -f "$RECORDED" "$EXPECTED"' EXIT

if [ -n "$recorded_raw" ] && [ "$recorded_raw" != "NULL" ]; then
  printf '%s' "$recorded_raw" | tr '@' '\n' | grep -v '^$' | sort > "$RECORDED"
else
  : > "$RECORDED"
fi

(cd migrations && ls -1 ./*.sql | sed 's|^\./||') | sort > "$EXPECTED"

if cmp -s "$RECORDED" "$EXPECTED"; then
  exit 0
fi

# ---------------------------------------------------------------------------
# 4. Stale. Say precisely what is missing before doing anything destructive.
# ---------------------------------------------------------------------------
missing="$(comm -13 "$RECORDED" "$EXPECTED")"
removed="$(comm -23 "$RECORDED" "$EXPECTED")"

echo
echo "The local database is behind migrations/."
if [ -s "$RECORDED" ]; then
  if [ -n "$missing" ]; then
    echo "  missing: $(echo "$missing" | wc -l | tr -d ' ') migration(s)"
    echo "$missing" | sed 's/^/    + /'
  fi
  if [ -n "$removed" ]; then
    echo "  applied but no longer in the repo:"
    echo "$removed" | sed 's/^/    - /'
  fi
else
  echo "  It records no migration set at all, so its contents are unknowable."
fi
echo "Rebuilding it. Local data is dumped first and restored afterwards."

# The data-fixup warning. A migration that only creates or alters tables is
# replayed onto an empty schema and the restored rows are unaffected. A
# migration that rewrites *rows* is not: the fresh volume applies it to seed
# data, and then the restore drops pre-fix rows back on top. Nothing can detect
# this reliably, so this is a heuristic on the leading keyword and it errs
# towards mentioning it.
if [ -n "$missing" ]; then
  fixups=""
  while IFS= read -r m; do
    [ -n "$m" ] || continue
    if grep -qiE '^[[:space:]]*(UPDATE|DELETE|INSERT)[[:space:]]' "migrations/$m"; then
      fixups="${fixups}${m}"$'\n'
    fi
  done <<< "$missing"

  if [ -n "$fixups" ]; then
    cat <<MSG

  Note: these change rows, not just schema -

$(echo "$fixups" | grep -v '^$' | sed 's/^/      /')

  The restore puts your existing rows back as they are, so anything one of
  those would have corrected stays uncorrected locally. Production has had
  them applied properly, so if the data looks wrong afterwards:

      scripts/sync-from-prod.sh
MSG
  fi
fi
echo

# ---------------------------------------------------------------------------
# 5. Dump the current data.
# ---------------------------------------------------------------------------
# Data only, into the schema the rebuild is about to create - the same posture
# sync-from-prod.sh takes towards production, and for the same reason: the local
# schema is about to be *ahead* of what this dump was taken from, and
# --complete-insert lets a new column simply take its default rather than
# failing on a column-count mismatch.
#
# _migration_status is excluded: it is the rebuild's own verdict, and restoring
# the old row would overwrite a correct `applied` set with the stale one this
# whole script exists to notice.
mkdir -p "$DUMP_DIR"
DUMP="$DUMP_DIR/pre-rebuild-$(date +%Y%m%d-%H%M%S).sql"

if docker compose exec -T -e MYSQL_PWD=root db mysqldump -h 127.0.0.1 -uroot \
     --no-create-info \
     --complete-insert \
     --skip-lock-tables \
     --ignore-table=bigshop._migration_status \
     bigshop > "$DUMP" 2>/dev/null && [ -s "$DUMP" ]; then
  echo "Dumped current local data to $DUMP"
else
  rm -f "$DUMP"
  DUMP=""
  echo "Nothing to dump (empty or unreadable database); rebuilding from seed."
fi

# ---------------------------------------------------------------------------
# 6. Destroy the volume and let the existing init path do its job.
# ---------------------------------------------------------------------------
# `docker compose down -v` would also take bigshop-lgtm-data with it. Removing
# the one volume by the name docker itself reports keeps local Grafana history,
# and cannot be wrong about which project it belongs to.
DB_VOLUME="$(docker inspect "$CID" \
  --format '{{range .Mounts}}{{if eq .Destination "/var/lib/mysql"}}{{.Name}}{{end}}{{end}}')"

if [ -z "$DB_VOLUME" ]; then
  echo "Could not identify the db data volume; refusing to guess." >&2
  exit 1
fi

# `api` too: it holds pooled connections to the database that is about to
# disappear, and compose will recreate it behind service_healthy anyway.
docker compose rm -sf db api >/dev/null 2>&1 || true
docker volume rm "$DB_VOLUME" >/dev/null

echo "Replaying $(wc -l < "$EXPECTED" | tr -d ' ') migrations..."
if ! docker compose up -d --wait --wait-timeout 300 db >/dev/null 2>&1; then
  cat >&2 <<'MSG'

The rebuilt database did not come up healthy, which means a migration failed to
apply - not that this script did. The replay says which:

    docker compose logs db | grep -A20 'not in expected-migration-errors'

MSG
  exit 1
fi

# ---------------------------------------------------------------------------
# 7. Restore.
# ---------------------------------------------------------------------------
if [ -z "$DUMP" ]; then
  echo "Database rebuilt on the current schema, with the dev seed."
  exit 0
fi

# Truncate exactly the tables the dump carries, so the seed rows just inserted
# do not collide with the restored ones on primary key - dev-seed.sql inserts
# local-dev-user, account_user and the unit rows, all of which are in the dump.
# Tables the dump does not carry keep their seeded contents.
TABLES="$(grep -o 'INSERT INTO `[^`]*`' "$DUMP" | sed 's/INSERT INTO `//; s/`$//' | sort -u)"

restore() {
  {
    echo "SET FOREIGN_KEY_CHECKS=0;"
    while IFS= read -r t; do
      [ -n "$t" ] && printf 'TRUNCATE TABLE `%s`;\n' "$t"
    done <<< "$TABLES"
    cat "$DUMP"
    echo "SET FOREIGN_KEY_CHECKS=1;"
  } | mysql_in_db bigshop
}

# No --force here, deliberately: this is the one step that can legitimately
# fail (a new NOT NULL column with no default, a new foreign key the old rows
# violate), and a half-applied restore is the worst possible outcome - it looks
# like it worked. Stop at the first error and rebuild clean instead.
if restore_error="$(restore 2>&1)"; then
  echo "Restored $(echo "$TABLES" | grep -c . ) tables from the dump."
  echo "Database is on the current schema with your data. $DUMP kept."
else
  docker compose rm -sf db >/dev/null 2>&1 || true
  docker volume rm "$DB_VOLUME" >/dev/null 2>&1 || true
  docker compose up -d --wait --wait-timeout 300 db >/dev/null 2>&1 || true

  cat >&2 <<MSG

Your data could not be restored onto the new schema:

$(echo "$restore_error" | sed 's/^/    /' | head -20)

That usually means a new migration added a column or constraint the old rows
cannot satisfy. The database has been rebuilt clean instead, so it is correct
and usable - it just has the dev seed rather than your data.

Your data is not lost. The dump is at:

    $DUMP

To get your real recipes back, the supported route is production:

    scripts/sync-from-prod.sh

MSG
fi
