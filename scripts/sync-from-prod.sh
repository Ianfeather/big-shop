#!/usr/bin/env bash
# Sync your own recipe data from production TiDB into the local dev database.
#
# Pulls only the given account's recipes/parts/tags, plus full copies of the
# shared reference tables (ingredient/unit/tag/department - not
# account-scoped), then maps everything to local account 1, which
# local-dev-user (the fixed identity DISABLE_AUTH mode uses) is already
# linked to. user/account/account_user are never touched.
#
# mysqldump runs inside a throwaway mysql:8.0 container rather than a host
# install, so nothing needs installing locally - and it sidesteps newer
# mysql clients (MySQL 9+) having dropped the mysql_native_password auth
# plugin that TiDB user accounts often still use.
#
# See docker/README.md for how to find your account id and for the
# reasoning behind this design.
#
# Usage:
#   scripts/sync-from-prod.sh
#
# Host, port, username, database and account id come from .env.tidb (tracked in
# git - see scripts/lib/tidb-env.sh); only the password is typed, on every run.
set -euo pipefail
cd "$(dirname "$0")/.."

. scripts/lib/tidb-env.sh
tidb_env_load

# ACCOUNT_ID is the one value that still asks when it has not been set. It can
# live in .env.tidb like the rest, but it must not silently default: migration
# 012 swapped accounts around, so 1 is not reliably yours in production, and a
# wrong guess pulls somebody else's recipes onto your laptop. Unset means ask.
if [ -z "${ACCOUNT_ID:-}" ]; then
  echo "ACCOUNT_ID is not set in .env.tidb. Find yours with"
  echo "  SELECT * FROM account_user;   -- in the TiDB console"
  read -rp "Account id [1]: " ACCOUNT_ID
  ACCOUNT_ID="${ACCOUNT_ID:-1}"
fi

tidb_prompt_password

mkdir -p docker/prod-dumps
DUMP_FILE="docker/prod-dumps/prod-sync-${ACCOUNT_ID}-$(date +%Y%m%d-%H%M%S).sql"

run_mysqldump() {
  # --no-create-info: data only, no DROP/CREATE TABLE. The local bigshop
  # database already has a correct, internally-consistent schema from
  # migrations/*.sql - we only want prod's data, not prod's DDL. TiDB's
  # dumped CREATE TABLE statements for different tables can carry subtly
  # different charset/collation metadata (hit this as an "incompatible" FK
  # error between recipe_tag.tag_name and tag.name), and re-creating tables
  # from them locally inherits that inconsistency. Importing data only into
  # our own already-migrated schema sidesteps that whole class of problem.
  #
  # No --single-transaction: mysqldump wraps every table it dumps (even one)
  # in a SAVEPOINT/ROLLBACK TO SAVEPOINT pair under that flag, and TiDB's
  # SAVEPOINT support doesn't fully match MySQL's, failing with "Couldn't
  # execute 'ROLLBACK TO SAVEPOINT sp': SAVEPOINT sp does not exist".
  # --skip-lock-tables instead: TiDB is MVCC-based like InnoDB, so an
  # unlocked read here is no less consistent than what --single-transaction
  # would have given, and it avoids relying on LOCK TABLES/FLUSH TABLES WITH
  # READ LOCK privileges a TiDB Cloud user may not even have.
  # --complete-insert: emit `INSERT INTO t (col, col, ...) VALUES ...` rather
  # than a bare `INSERT INTO t VALUES ...`. Essential given --no-create-info,
  # because the local schema is routinely *ahead* of production - that's the
  # normal state while a migration is being developed. A positional INSERT
  # carries production's column count and fails against a local table that has
  # gained a column, with "Column count doesn't match value count at row 1".
  # With explicit column names the local-only columns simply take their
  # defaults, which is exactly right: a column production doesn't have yet has
  # no value to sync.
  docker run --rm -e MYSQL_PWD="$TIDB_PASSWORD" mysql:8.0 \
    mysqldump -h "$TIDB_HOST" -P "$TIDB_PORT" -u "$TIDB_USER" \
    --ssl-mode=REQUIRED \
    --no-create-info \
    --complete-insert \
    --skip-lock-tables \
    --set-gtid-purged=OFF \
    "$@"
}

echo "Exporting shared reference tables (ingredients, units, tags, departments)..."
run_mysqldump "$TIDB_DB" department unit ingredient tag ingredient_department > "$DUMP_FILE"

echo "Exporting your recipes (account_id=${ACCOUNT_ID})..."
run_mysqldump "$TIDB_DB" recipe --where="account_id=${ACCOUNT_ID}" >> "$DUMP_FILE"

echo "Exporting those recipes' ingredients..."
run_mysqldump "$TIDB_DB" part \
  --where="recipe_id IN (SELECT id FROM recipe WHERE account_id=${ACCOUNT_ID})" >> "$DUMP_FILE"

echo "Exporting those recipes' tags..."
run_mysqldump "$TIDB_DB" recipe_tag \
  --where="recipe_id IN (SELECT id FROM recipe WHERE account_id=${ACCOUNT_ID})" >> "$DUMP_FILE"

echo "Saved to ${DUMP_FILE}"

echo "Bringing up the local db container..."
docker compose up -d db

echo "Waiting for MySQL to be ready..."
until docker compose exec -T db mysqladmin ping -uroot -proot --silent 2>/dev/null; do
  sleep 1
done

echo "Clearing existing recipe-related tables locally..."
echo "(any local-only test data in these tables will be lost)"
# Deliberately NOT truncating ingredient_unit_size: Unit Sizes are curated
# local seed data (see specs/unit-normalisation.md), not production data, so a
# sync should preserve them. They keep pointing at the right rows because the
# import carries production's ingredient ids verbatim. The one rough edge: a
# Unit Size for an ingredient production no longer has would be left orphaned,
# since FK checks are off across the truncate - harmless until something tries
# to enforce them.
docker compose exec -T db mysql -uroot -proot bigshop -e "
  SET FOREIGN_KEY_CHECKS=0;
  TRUNCATE TABLE recipe_tag;
  TRUNCATE TABLE part;
  TRUNCATE TABLE ingredient_department;
  TRUNCATE TABLE recipe;
  TRUNCATE TABLE tag;
  TRUNCATE TABLE ingredient;
  TRUNCATE TABLE unit;
  TRUNCATE TABLE department;
  SET FOREIGN_KEY_CHECKS=1;
"

echo "Importing into the local bigshop database..."
docker compose exec -T db mysql -uroot -proot bigshop < "$DUMP_FILE"

echo "Mapping imported recipes to local account 1..."
docker compose exec -T db mysql -uroot -proot bigshop -e "UPDATE recipe SET account_id = 1;"

echo "Done. local-dev-user (account 1) now sees your production recipes."
echo "Dump saved at ${DUMP_FILE} if you want to inspect it or re-import it later."
