#!/bin/bash
set -euo pipefail

# migrations/001_init.sql opens with `CREATE DATABASE bigshop;`, but that
# doesn't select the new database for the rest of the same session - the file
# was always run interactively with the DB pre-selected. Create the database
# separately, then apply the rest of 001 (and everything after) with -D bigshop.
mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "CREATE DATABASE IF NOT EXISTS bigshop;"
tail -n +2 /migrations/001_init.sql | mysql -uroot -p"$MYSQL_ROOT_PASSWORD" bigshop

for f in /migrations/*.sql; do
  base="$(basename "$f")"
  if [ "$base" = "001_init.sql" ]; then
    continue
  fi
  echo "Applying migration: $base"
  # --force: these migrations were applied by hand against a live DB over
  # time, not replayed in order from scratch, so some later files re-apply a
  # schema change an earlier "checkpoint" migration already folded in (e.g.
  # 002_unique.sql re-adding a column 001_init.sql already has). --force
  # skips just the failing statement and continues, which is fine here since
  # the end schema is what we're actually verifying, not this file in isolation.
  mysql --force -uroot -p"$MYSQL_ROOT_PASSWORD" bigshop < "$f"
done

echo "Applying dev seed data"
mysql -uroot -p"$MYSQL_ROOT_PASSWORD" bigshop < /seed/dev-seed.sql
