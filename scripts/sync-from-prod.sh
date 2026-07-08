#!/usr/bin/env bash
# Sync your own recipe data from production TiDB into the local dev database.
#
# Pulls only the given account's recipes/parts/tags, plus full copies of the
# shared reference tables (ingredient/unit/tag/department - not
# account-scoped), then maps everything to local account 1, which
# local-dev-user (the fixed identity DISABLE_AUTH mode uses) is already
# linked to. user/account/account_user are never touched.
#
# See docker/README.md for how to find your account id and for the
# reasoning behind this design.
#
# Usage:
#   TIDB_HOST=<host> TIDB_USER=<user> scripts/sync-from-prod.sh <prod_account_id>
#
# Env vars:
#   TIDB_HOST  (required)
#   TIDB_USER  (required)
#   TIDB_PORT  (default 4000 - TiDB Cloud's protocol port, not MySQL's 3306)
set -euo pipefail
cd "$(dirname "$0")/.."

ACCOUNT_ID="${1:?Usage: TIDB_HOST=<host> TIDB_USER=<user> scripts/sync-from-prod.sh <prod_account_id>}"
: "${TIDB_HOST:?Set TIDB_HOST to your TiDB Cloud host}"
: "${TIDB_USER:?Set TIDB_USER to your TiDB Cloud username}"
TIDB_PORT="${TIDB_PORT:-4000}"

mkdir -p docker/prod-dumps
DUMP_FILE="docker/prod-dumps/prod-sync-${ACCOUNT_ID}-$(date +%Y%m%d-%H%M%S).sql"

read -rs -p "TiDB password for ${TIDB_USER}@${TIDB_HOST}: " TIDB_PASSWORD
echo
export MYSQL_PWD="$TIDB_PASSWORD"

DUMP_ARGS=(
  -h "$TIDB_HOST" -P "$TIDB_PORT" -u "$TIDB_USER"
  --ssl-mode=REQUIRED
  --single-transaction
  --no-tablespaces
  --set-gtid-purged=OFF
  --no-create-db
)

echo "Exporting shared reference tables (ingredients, units, tags, departments)..."
mysqldump "${DUMP_ARGS[@]}" bigshop department unit ingredient tag ingredient_department > "$DUMP_FILE"

echo "Exporting your recipes (account_id=${ACCOUNT_ID})..."
mysqldump "${DUMP_ARGS[@]}" bigshop recipe --where="account_id=${ACCOUNT_ID}" >> "$DUMP_FILE"

echo "Exporting those recipes' ingredients..."
mysqldump "${DUMP_ARGS[@]}" bigshop part \
  --where="recipe_id IN (SELECT id FROM recipe WHERE account_id=${ACCOUNT_ID})" >> "$DUMP_FILE"

echo "Exporting those recipes' tags..."
mysqldump "${DUMP_ARGS[@]}" bigshop recipe_tag \
  --where="recipe_id IN (SELECT id FROM recipe WHERE account_id=${ACCOUNT_ID})" >> "$DUMP_FILE"

unset MYSQL_PWD
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
