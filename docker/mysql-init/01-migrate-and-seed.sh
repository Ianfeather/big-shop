#!/bin/bash
set -euo pipefail

MIGRATIONS=/migrations
ALLOWLIST=/docker-entrypoint-initdb.d/expected-migration-errors.txt

# Every ERROR any migration produced, normalised to "<file>:<line>:<errno>".
ACTUAL="$(mktemp)"
EXPECTED="$(mktemp)"
: > "$ACTUAL"

sql() { mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$@"; }

# migrations/001_init.sql opens with `CREATE DATABASE bigshop;`, but that
# doesn't select the new database for the rest of the same session - the file
# was always run interactively with the DB pre-selected. Create the database
# separately, then apply the rest of 001 (and everything after) with -D bigshop.
sql -e "CREATE DATABASE IF NOT EXISTS bigshop;"

# The verdict on this replay, written before anything is applied and only
# flipped to ok=1 at the very end. It lives in the database, not in a file or
# an exit code, because it has to survive a container restart - see the
# comment above the failure banner at the bottom for why that matters.
sql bigshop -e "
  CREATE TABLE IF NOT EXISTS \`_migration_status\` (
    \`id\` tinyint NOT NULL,
    \`ok\` tinyint(1) NOT NULL COMMENT '1 only if every migration applied as expected and the seed loaded',
    \`detail\` text COMMENT 'the unexpected errors, when ok = 0',
    \`applied_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`)
  ) COLLATE=utf8mb4_bin
    COMMENT 'set by docker/mysql-init/01-migrate-and-seed.sh; read by the db healthcheck';
  REPLACE INTO \`_migration_status\` (id, ok, detail) VALUES (1, 0, 'migrations did not finish');
"

for f in "$MIGRATIONS"/*.sql; do
  base="$(basename "$f")"
  echo "Applying migration: $base"

  errfile="$(mktemp)"
  # --force skips just the failing statement and continues. It is needed
  # because a few early migrations genuinely cannot apply to an empty schema -
  # see expected-migration-errors.txt for the list and the reasoning. It also
  # means mysql exits 0 no matter what went wrong, which is why the errors are
  # captured here and reconciled against that file below.
  if [ "$base" = "001_init.sql" ]; then
    tail -n +2 "$f" | mysql --force -uroot -p"$MYSQL_ROOT_PASSWORD" bigshop 2>"$errfile" || true
  else
    mysql --force -uroot -p"$MYSQL_ROOT_PASSWORD" bigshop < "$f" 2>"$errfile" || true
  fi

  while IFS= read -r line; do
    echo "  $line" >&2
    # "ERROR 1060 (42S21) at line 2: Duplicate column name 'remote_url'"
    if [[ "$line" =~ ^ERROR\ ([0-9]+)\ \([^\)]*\)\ at\ line\ ([0-9]+): ]]; then
      echo "$base:${BASH_REMATCH[2]}:${BASH_REMATCH[1]}" >> "$ACTUAL"
    else
      # An error with no line number (a connection failure, say). Not
      # allowlistable by key, and shouldn't be - fail on it.
      echo "$base:UNPARSED" >> "$ACTUAL"
    fi
  done < <(grep '^ERROR ' "$errfile" || true)
  rm -f "$errfile"
done

sed -E 's/#.*//; s/[[:space:]]//g' "$ALLOWLIST" | grep -v '^$' | sort -u > "$EXPECTED"
sort -u "$ACTUAL" -o "$ACTUAL"

# In the allowlist but didn't happen: somebody fixed a migration and left the
# entry behind. Worth saying, not worth blocking a database on.
stale="$(comm -13 "$ACTUAL" "$EXPECTED")"
if [ -n "$stale" ]; then
  echo "NOTE: these expected-migration-errors.txt entries did not occur; the" >&2
  echo "      migration may have been fixed, in which case drop them:" >&2
  echo "$stale" | sed 's/^/        /' >&2
fi

# Happened but not in the allowlist: --force skipped a statement nobody
# accounted for, so the schema in this container is missing whatever that
# statement did. That is the failure mode this whole dance exists to catch.
unexpected="$(comm -23 "$ACTUAL" "$EXPECTED")"
if [ -n "$unexpected" ]; then
  cat >&2 <<MSG

=======================================================================
Migration replay hit an error that is not in expected-migration-errors.txt:

$(echo "$unexpected" | sed 's/^/    /')

--force SKIPPED that statement, so this database is missing whatever it
was going to do. _migration_status.ok stays 0, which fails the db
healthcheck, so nothing that depends_on it will start against this schema.

Fix the migration. If it genuinely cannot apply to an empty database, add
it to docker/mysql-init/expected-migration-errors.txt with a note saying
why. Then recreate the volume: the entrypoint only runs this script when
the data directory is empty.

    docker compose down -v && docker compose up -d db
=======================================================================
MSG
  # Deliberately NOT `exit 1`. A non-zero exit here aborts the entrypoint and
  # kills the container, but `restart: unless-stopped` then brings it straight
  # back - and on that second start the data directory is no longer empty, so
  # the entrypoint skips docker-entrypoint-initdb.d entirely and mysqld comes
  # up reporting healthy against the very half-built schema this check exists
  # to reject. Verified: that is exactly what happens.
  #
  # So the verdict is left in _migration_status instead, where a restart
  # cannot wash it off, and the healthcheck is what refuses. The container
  # stays up and connectable, which is also the state you want for working
  # out what actually broke.
  detail="$(echo "$unexpected" | tr '\n' ' ')"
  sql bigshop -e "REPLACE INTO \`_migration_status\` (id, ok, detail) VALUES (1, 0, '$(echo "$detail" | sed "s/'/''/g")');"
  exit 0
fi

# The per-file ledger that internal/pkg/migrate reads, written here so that a
# freshly built dev volume is already adopted and `go run . migrate` behaves
# locally exactly as it does against production.
#
# Distinct from _migration_status above, which is one row and a boolean
# answering "did this volume's single replay go cleanly?" for the healthcheck.
# This is the durable record of *which* files ran, and it is the same table the
# production database has - so the thing exercised locally is the real thing.
#
# Populated only on the success path, below the allowlist reconciliation and
# above the seed, for the same reason ok = 1 is: a volume must never report a
# migration it did not finish applying.
echo "Recording the applied migrations in schema_migration"
sql bigshop -e "
  CREATE TABLE IF NOT EXISTS \`schema_migration\` (
    \`filename\` varchar(255) NOT NULL COMMENT 'basename of the file in migrations/',
    \`checksum\` char(64) NOT NULL COMMENT 'SHA-256 of the file as applied; empty means unknown',
    \`applied_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`filename\`)
  ) COLLATE=utf8mb4_bin COMMENT='applied migrations; written by internal/pkg/migrate';
"
for f in "$MIGRATIONS"/*.sql; do
  base="$(basename "$f")"
  sum="$(sha256sum "$f" | cut -d' ' -f1)"
  sql bigshop -e "INSERT IGNORE INTO \`schema_migration\` (filename, checksum) VALUES ('$base', '$sum');"
done

echo "Applying dev seed data"
sql bigshop < /seed/dev-seed.sql

# Last, and after the ledger rows above: `ok = 1` is the assertion that this
# replay finished, so nothing that reads it may be written afterwards. The
# healthcheck requires both this and a ledger matching ./migrations, and a
# volume must never be able to report a migration set it did not finish
# applying.
sql bigshop -e "REPLACE INTO \`_migration_status\` (id, ok, detail) VALUES (1, 1, NULL);"
echo "Migrations and seed applied; _migration_status.ok = 1"
