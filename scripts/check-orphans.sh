#!/usr/bin/env bash
# Check production TiDB for rows whose foreign key points at a deleted parent.
#
# Read-only - counts rows and nothing else, so it is safe to run against
# production at any time. Run it BEFORE a data migration to get a baseline, and
# AFTER to prove the migration did not strand anything.
#
# Worth doing because TiDB does not have all the constraints a database built
# from migrations/*.sql has. Production declares far fewer of them, so a DELETE
# from a parent table that errors locally can succeed against production and
# silently orphan its children. Migration 029 did exactly that with
# `thyme sprig`, and the recipe holding that Ingredient Line just lost it.
#
# That gap is also why this does not check declared constraints alone: doing so
# would cover fewer than half the schema's relationships and still look clean.
# scripts/check-orphans.sql adds every column named `<table>_id` whose table
# exists, declared or not. This run prints both counts below, for whichever
# database it is pointed at.
#
# Runs in two steps rather than generating the checks in SQL. TiDB rejects
# `SELECT ... INTO @var` outright, so the dynamic-SQL version of this failed
# there while passing on MySQL. Introspect, build, run - each step inspectable:
#
#   ... check-orphans.sql | scripts/build-orphan-checks.py   # see the SQL
#
# mysql runs inside a throwaway mysql:8.0 container rather than a host install,
# for the same reasons as sync-from-prod.sh: nothing to install, and it avoids
# MySQL 9+ having dropped the mysql_native_password plugin TiDB accounts often
# still use.
#
# Host, port, username and database come from .env.tidb (tracked in git - see
# scripts/lib/tidb-env.sh); only the password is typed, on every run. It is
# passed via the container's environment, never on the command line where it
# would show up in the process list.
#
# Usage:
#   scripts/check-orphans.sh
set -euo pipefail
cd "$(dirname "$0")/.."

. scripts/lib/tidb-env.sh
tidb_env_load
tidb_prompt_password

# SQL on stdin; any extra mysql flags as arguments.
run_mysql() {
  docker run --rm -i -e MYSQL_PWD="$TIDB_PASSWORD" mysql:8.0 \
    mysql -h "$TIDB_HOST" -P "$TIDB_PORT" -u "$TIDB_USER" \
    --ssl-mode=REQUIRED "$@" "$TIDB_DB"
}

echo
echo "Checking ${TIDB_DB} on ${TIDB_HOST} for orphaned rows..."
echo

echo "SELECT VERSION() AS server,
       (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL) AS declared_fks;" \
  | run_mysql --table

RELATIONSHIPS="$(run_mysql -N < scripts/check-orphans.sql)"
CHECKS="$(printf '%s\n' "$RELATIONSHIPS" | scripts/build-orphan-checks.py)"

echo
echo "Relationships checked: $(printf '%s\n' "$RELATIONSHIPS" | cut -f1,2 | sort -u | wc -l | tr -d ' ')"
echo

printf '%s\n' "$CHECKS" | run_mysql --table

echo
echo "Rows above are orphans, one line per relationship; no table means none were"
echo "found. 'Relationships checked' higher than 'declared_fks' is expected and"
echo "intended - see the comments in scripts/check-orphans.sql."
