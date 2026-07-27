#!/usr/bin/env bash
# Check production TiDB for rows whose foreign key points at a deleted parent.
#
# Read-only - counts rows and nothing else, so it is safe to run against
# production at any time. Run it BEFORE a data migration to get a baseline, and
# AFTER to prove the migration did not strand anything.
#
# Worth doing because TiDB may not enforce foreign keys the way a MySQL
# database built from migrations/*.sql does. A DELETE from a parent table that
# errors locally can succeed against production and silently orphan its
# children - migration 029 did exactly that with `thyme sprig`, and the recipe
# holding that Ingredient Line just lost it. See scripts/check-orphans.sql.
#
# mysql runs inside a throwaway mysql:8.0 container rather than a host install,
# for the same reasons as sync-from-prod.sh: nothing to install, and it avoids
# MySQL 9+ having dropped the mysql_native_password plugin TiDB accounts often
# still use.
#
# Credentials come from the TiDB Cloud console. The password is passed via the
# container's environment, never on the command line where it would show up in
# the process list.
#
# Usage:
#   scripts/check-orphans.sh
set -euo pipefail
cd "$(dirname "$0")/.."

read -rp "TiDB host: " TIDB_HOST
read -rp "TiDB port [4000]: " TIDB_PORT
TIDB_PORT="${TIDB_PORT:-4000}"
read -rp "TiDB username: " TIDB_USER
read -rsp "TiDB password: " TIDB_PASSWORD
echo
read -rp "Database [bigshop]: " TIDB_DB
TIDB_DB="${TIDB_DB:-bigshop}"

echo
echo "Checking ${TIDB_DB} on ${TIDB_HOST} for orphaned rows..."
echo

docker run --rm -i -e MYSQL_PWD="$TIDB_PASSWORD" mysql:8.0 \
  mysql -h "$TIDB_HOST" -P "$TIDB_PORT" -u "$TIDB_USER" \
  --ssl-mode=REQUIRED --table "$TIDB_DB" < scripts/check-orphans.sql

echo
echo "Done. A 'broken_reference' table above lists each constraint with orphaned"
echo "rows; no such table means none were found."
echo
echo "If declared_fks came back as 0, this server is not tracking constraints at"
echo "all - no checks could be derived, and nothing is protecting these tables."
