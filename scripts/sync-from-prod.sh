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
set -euo pipefail
cd "$(dirname "$0")/.."

read -rp "TiDB host: " TIDB_HOST
read -rp "TiDB port [4000]: " TIDB_PORT
TIDB_PORT="${TIDB_PORT:-4000}"
read -rp "TiDB username: " TIDB_USER
read -rsp "TiDB password: " TIDB_PASSWORD
echo
read -rp "Account id [1]: " ACCOUNT_ID
ACCOUNT_ID="${ACCOUNT_ID:-1}"

mkdir -p docker/prod-dumps
DUMP_FILE="docker/prod-dumps/prod-sync-${ACCOUNT_ID}-$(date +%Y%m%d-%H%M%S).sql"

run_mysqldump() {
  # No --single-transaction: mysqldump wraps every table it dumps (even one)
  # in a SAVEPOINT/ROLLBACK TO SAVEPOINT pair under that flag, and TiDB's
  # SAVEPOINT support doesn't fully match MySQL's, failing with "Couldn't
  # execute 'ROLLBACK TO SAVEPOINT sp': SAVEPOINT sp does not exist".
  # --skip-lock-tables instead: TiDB is MVCC-based like InnoDB, so an
  # unlocked read here is no less consistent than what --single-transaction
  # would have given, and it avoids relying on LOCK TABLES/FLUSH TABLES WITH
  # READ LOCK privileges a TiDB Cloud user may not even have.
  docker run --rm -e MYSQL_PWD="$TIDB_PASSWORD" mysql:8.0 \
    mysqldump -h "$TIDB_HOST" -P "$TIDB_PORT" -u "$TIDB_USER" \
    --ssl-mode=REQUIRED \
    --skip-lock-tables \
    --no-tablespaces \
    --set-gtid-purged=OFF \
    --no-create-db \
    "$@"
}

echo "Exporting shared reference tables (ingredients, units, tags, departments)..."
run_mysqldump bigshop department unit ingredient tag ingredient_department > "$DUMP_FILE"

echo "Exporting your recipes (account_id=${ACCOUNT_ID})..."
run_mysqldump bigshop recipe --where="account_id=${ACCOUNT_ID}" >> "$DUMP_FILE"

echo "Exporting those recipes' ingredients..."
run_mysqldump bigshop part \
  --where="recipe_id IN (SELECT id FROM recipe WHERE account_id=${ACCOUNT_ID})" >> "$DUMP_FILE"

echo "Exporting those recipes' tags..."
run_mysqldump bigshop recipe_tag \
  --where="recipe_id IN (SELECT id FROM recipe WHERE account_id=${ACCOUNT_ID})" >> "$DUMP_FILE"

echo "Saved to ${DUMP_FILE}"

echo "Bringing up the local db container..."
docker compose up -d db

echo "Waiting for MySQL to be ready..."
until docker compose exec -T db mysqladmin ping -uroot -proot --silent 2>/dev/null; do
  sleep 1
done

echo "Importing into the local bigshop database..."
echo "(this replaces the recipe/ingredient/unit/tag/department tables entirely - any local-only test data in those tables will be lost)"
docker compose exec -T db mysql -uroot -proot bigshop < "$DUMP_FILE"

echo "Mapping imported recipes to local account 1..."
docker compose exec -T db mysql -uroot -proot bigshop -e "UPDATE recipe SET account_id = 1;"

echo "Done. local-dev-user (account 1) now sees your production recipes."
echo "Dump saved at ${DUMP_FILE} if you want to inspect it or re-import it later."
