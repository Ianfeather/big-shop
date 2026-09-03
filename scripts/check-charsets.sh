#!/usr/bin/env bash
# Report the charset and collation of every table and text column, and scan the
# non-utf8mb4 ones for text that cannot have survived being stored there.
#
# Read-only - counts rows and reads information_schema, nothing else - so it is
# safe against production at any time.
#
# Why it exists: production TiDB has no single charset. Each table took whatever
# the server default was on the day it was hand-applied, so `user`/`recipe`/
# `account` are utf8 (utf8mb3, deprecated), `list` and `part` are latin1, `tag`
# is utf8mb4, and the database default is utf8mb4. A local MySQL 8 built from
# migrations/*.sql is uniformly utf8mb4_0900_ai_ci, so none of this is
# reproducible locally and the only way to know the real state is to ask.
#
# It has already been paid for twice: docker/README.md records an
# incompatible-FK error between `recipe_tag.tag_name` and `tag.name` when
# importing production's DDL, which is why sync-from-prod.sh dumps data only;
# and migration 034 could not be applied to production until `user.id` was
# normalised.
#
# The scan answers the question that decides whether latin1 on `list` is a
# latent problem or an active one: is there text in those columns that is
# already damaged, or non-ASCII text at all that could be?
#
# mysql runs inside a throwaway mysql:8.0 container rather than a host install,
# for the same reasons as check-orphans.sh: nothing to install, and it avoids
# MySQL 9+ having dropped the mysql_native_password plugin TiDB accounts often
# still use.
#
# Host, port, username and database come from .env.tidb (tracked in git - see
# scripts/lib/tidb-env.sh); only the password is typed, on every run. It is
# passed via the container's environment, never on the command line where it
# would show up in the process list.
#
# Usage:
#   scripts/check-charsets.sh
set -euo pipefail
cd "$(dirname "$0")/.."

. scripts/lib/tidb-env.sh
tidb_env_load

# Connect as the read-only account rather than as .env.tidb's TIDB_USER, which
# names root. This script only ever reads, so a root session buys it nothing and
# costs the difference between a mistyped statement that cannot write and one
# that can. docs/reporting-database-user.md has the grant - plain SELECT on
# bigshop, established by running exactly these queries under it.
#
# Falls back to TIDB_USER when no such account is configured, so this behaves
# as it always did until someone creates one. `TIDB_USER=... scripts/...` still
# wins, for connecting as somebody else deliberately.
tidb_env_prefer_user TIDB_READONLY_USER

tidb_prompt_password

# SQL on stdin; any extra mysql flags as arguments.
#
# --default-character-set=utf8mb4 is load-bearing rather than tidy: the scan
# below looks for byte sequences, so the connection has to hand them over
# unchanged rather than transcoding them into whatever the client guessed.
run_mysql() {
  docker run --rm -i -e MYSQL_PWD="$TIDB_PASSWORD" mysql:8.0 \
    mysql -h "$TIDB_HOST" -P "$TIDB_PORT" -u "$TIDB_USER" \
    --ssl-mode=REQUIRED --default-character-set=utf8mb4 "$@" "$TIDB_DB"
}

echo
echo "Charsets in ${TIDB_DB} on ${TIDB_HOST}"
echo

echo "SELECT VERSION() AS server,
       @@character_set_database AS db_charset,
       @@collation_database AS db_collation;" | run_mysql --table

echo
echo "Per table:"
echo "SELECT TABLE_NAME, TABLE_COLLATION
        FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_COLLATION, TABLE_NAME;" | run_mysql --table

echo
echo "Text columns that are not utf8mb4:"
echo "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, COLLATION_NAME
        FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND CHARACTER_SET_NAME IS NOT NULL
         AND CHARACTER_SET_NAME <> 'utf8mb4'
       ORDER BY CHARACTER_SET_NAME, TABLE_NAME, ORDINAL_POSITION;" | run_mysql --table

COLUMNS="$(run_mysql -N < scripts/check-charsets.sql)"
CHECKS="$(printf '%s\n' "$COLUMNS" | scripts/build-charset-checks.py)"

echo
echo "Scanning those columns for damaged or at-risk text:"
echo
printf '%s\n' "$CHECKS" | run_mysql --table

echo
echo "non_ascii  = rows holding any character above U+007F. Zero means a"
echo "             charset change on that column cannot corrupt anything,"
echo "             because there is nothing there to corrupt."
echo "mojibake   = rows already showing the UTF-8-stored-as-latin1 fingerprint."
echo "             Anything above zero is damage that a plain ALTER would"
echo "             preserve rather than repair - fix the data first."
