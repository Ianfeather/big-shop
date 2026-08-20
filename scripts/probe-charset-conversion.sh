#!/usr/bin/env bash
# Find out which charset conversions TiDB will actually accept, by trying them
# on scratch tables that mirror the real ones.
#
# ---------------------------------------------------------------------------
# THIS SCRIPT WRITES TO THE DATABASE
# ---------------------------------------------------------------------------
# Unlike check-orphans.sh and check-charsets.sh, this is not read-only. It
# CREATEs and DROPs tables named `_charset_probe_*` and touches nothing else -
# no existing table is read, altered or locked. It asks for confirmation before
# doing anything, and drops what it made on the way out, including on failure.
#
# ---------------------------------------------------------------------------
# Why it has to exist
# ---------------------------------------------------------------------------
# Production is a charset patchwork: four tables are latin1_bin, seven are
# utf8_bin (utf8mb3, deprecated), eight are already utf8mb4_bin. The plan is to
# bring all of them to utf8mb4_bin. The blocker is that TiDB has historically
# supported `ALTER TABLE ... CONVERT TO CHARACTER SET` only for utf8 ->
# utf8mb4, and may reject latin1 -> utf8mb4 outright with "Unsupported modify
# charset". Whether that still holds on v8.5.3 decides whether the migration is
# four ALTERs or something considerably more careful, and it cannot be found
# out locally: a MySQL 8 built from migrations/*.sql is uniformly utf8mb4, so
# there is no latin1 table to convert and MySQL would accept it anyway.
#
# Guessing here is expensive in a specific way. These migrations are applied to
# production by hand, so a form TiDB rejects is discovered halfway through a
# manual run, against real tables, with some already converted.
#
# ---------------------------------------------------------------------------
# What it probes
# ---------------------------------------------------------------------------
# Both source charsets, both conversion forms, and the two shapes in the real
# schema that are more than a plain varchar:
#
#   * a UNIQUE-indexed varchar   - ingredient.name and unit.name both have one
#                                  (migrations 002 and 016). Changing the
#                                  collation under a unique index changes what
#                                  "duplicate" means, and is the most likely
#                                  thing to be refused.
#   * an enum                    - unit.kind is enum('weight','volume',
#                                  'relative') latin1_bin. An enum's value
#                                  strings carry the charset, so it converts
#                                  like a varchar and fails like one.
#
# It also checks the thing that actually matters afterwards: that non-ASCII
# text survives the conversion as the same characters, and that a 4-byte
# character - the whole point of utf8mb4 - can be stored once it is done.
#
# Connection details come from .env.tidb, password typed on every run, mysql in
# a throwaway container - all exactly as check-charsets.sh does it.
#
# Usage:
#   scripts/probe-charset-conversion.sh
set -euo pipefail
cd "$(dirname "$0")/.."

. scripts/lib/tidb-env.sh
tidb_env_load

cat <<MSG

This probe CREATEs and DROPs tables named _charset_probe_* on:

    ${TIDB_DB} at ${TIDB_HOST}

It reads and alters no existing table. Nothing else is touched.

MSG

read -r -p "Continue? [y/N] " reply
case "$reply" in
  [yY]|[yY][eE][sS]) ;;
  *) echo "Aborted."; exit 1 ;;
esac

tidb_prompt_password

run_mysql() {
  docker run --rm -i -e MYSQL_PWD="$TIDB_PASSWORD" mysql:8.0 \
    mysql -h "$TIDB_HOST" -P "$TIDB_PORT" -u "$TIDB_USER" \
    --ssl-mode=REQUIRED --default-character-set=utf8mb4 "$@" "$TIDB_DB"
}

cleanup() {
  echo
  echo "Dropping probe tables..."
  echo "DROP TABLE IF EXISTS _charset_probe_latin1, _charset_probe_utf8,
                              _charset_probe_col, _charset_probe_enum;" \
    | run_mysql 2>/dev/null || true
}
trap cleanup EXIT

# Runs one statement and reports whether TiDB accepted it. Never fatal - a
# refusal is a result, not an error, and the next probe still needs to run.
# $1 = label, rest = SQL.
try() {
  local label="$1"; shift
  local err
  err="$(printf '%s' "$*" | run_mysql 2>&1 >/dev/null)" && {
    printf '  ACCEPTED  %s\n' "$label"
    return 0
  }
  printf '  REFUSED   %s\n' "$label"
  printf '%s\n' "$err" | grep -i '^ERROR' | sed 's/^/              /'
  return 1
}

cleanup >/dev/null 2>&1 || true
trap cleanup EXIT

echo
echo "Server:"
echo "SELECT VERSION() AS server;" | run_mysql --table

# ---------------------------------------------------------------------------
# 1. Whole-table CONVERT TO, from each source charset.
# ---------------------------------------------------------------------------
echo
echo "1. ALTER TABLE ... CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin"
echo

printf '%s' "
CREATE TABLE _charset_probe_latin1 (
  id int NOT NULL AUTO_INCREMENT,
  name varchar(255) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_name (name)
) DEFAULT CHARSET=latin1 COLLATE=latin1_bin;
INSERT INTO _charset_probe_latin1 (name) VALUES ('plain ascii'), ('Crème Fraîche');
" | run_mysql

printf '%s' "
CREATE TABLE _charset_probe_utf8 (
  id int NOT NULL AUTO_INCREMENT,
  name varchar(255) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_name (name)
) DEFAULT CHARSET=utf8 COLLATE=utf8_bin;
INSERT INTO _charset_probe_utf8 (name) VALUES ('plain ascii'), ('Crème Fraîche');
" | run_mysql

latin1_ok=0
utf8_ok=0
try "latin1_bin -> utf8mb4_bin, UNIQUE-indexed varchar" \
  "ALTER TABLE _charset_probe_latin1 CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;" \
  && latin1_ok=1
try "utf8_bin   -> utf8mb4_bin, UNIQUE-indexed varchar" \
  "ALTER TABLE _charset_probe_utf8 CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;" \
  && utf8_ok=1

# ---------------------------------------------------------------------------
# 2. Per-column MODIFY - the fallback if CONVERT TO is refused.
# ---------------------------------------------------------------------------
echo
echo "2. ALTER TABLE ... MODIFY COLUMN ... CHARACTER SET utf8mb4 (the fallback)"
echo

printf '%s' "
CREATE TABLE _charset_probe_col (
  id int NOT NULL AUTO_INCREMENT,
  name varchar(255) NOT NULL,
  PRIMARY KEY (id)
) DEFAULT CHARSET=latin1 COLLATE=latin1_bin;
INSERT INTO _charset_probe_col (name) VALUES ('Crème Fraîche');
" | run_mysql

try "latin1_bin -> utf8mb4_bin, single column" \
  "ALTER TABLE _charset_probe_col MODIFY name varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;"

# ---------------------------------------------------------------------------
# 3. An enum - unit.kind is one, and its value strings carry the charset.
# ---------------------------------------------------------------------------
echo
echo "3. An enum column (unit.kind's shape)"
echo

printf '%s' "
CREATE TABLE _charset_probe_enum (
  id int NOT NULL AUTO_INCREMENT,
  kind enum('weight','volume','relative') NOT NULL,
  PRIMARY KEY (id)
) DEFAULT CHARSET=latin1 COLLATE=latin1_bin;
INSERT INTO _charset_probe_enum (kind) VALUES ('weight'), ('volume');
" | run_mysql

try "latin1_bin -> utf8mb4_bin, enum column" \
  "ALTER TABLE _charset_probe_enum CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;"

echo
echo "  Enum values and rows after the attempt:"
echo "SELECT COLUMN_TYPE, COLLATION_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '_charset_probe_enum'
         AND COLUMN_NAME = 'kind';
      SELECT kind, COUNT(*) AS rows_kept FROM _charset_probe_enum GROUP BY kind;" \
  | run_mysql --table | sed 's/^/  /'

# ---------------------------------------------------------------------------
# 4. Did the text survive, and can 4-byte characters be stored now?
# ---------------------------------------------------------------------------
echo
echo "4. Data integrity after conversion"
echo
echo "   'text_intact' must be 1: the non-ASCII row still reads as the same"
echo "   characters. HEX changes on purpose - that is the re-encoding."
echo

for t in _charset_probe_latin1 _charset_probe_utf8; do
  echo "SELECT '$t' AS probe, name, HEX(name) AS bytes,
                (name = 'Crème Fraîche') AS text_intact,
                (SELECT COLLATION_NAME FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '$t'
                    AND COLUMN_NAME = 'name') AS collation_now
           FROM $t WHERE id = 2;" | run_mysql --table | sed 's/^/  /'
done

echo
echo "   A 4-byte character is what utf8mb4 buys. Before conversion both"
echo "   tables reject it; after a successful one they should accept it."
echo
if [ "$latin1_ok" = "1" ]; then
  try "storing a 4-byte character in the converted latin1 table" \
    "INSERT INTO _charset_probe_latin1 (name) VALUES ('smoked paprika 🌶');"
fi
if [ "$utf8_ok" = "1" ]; then
  try "storing a 4-byte character in the converted utf8mb3 table" \
    "INSERT INTO _charset_probe_utf8 (name) VALUES ('smoked paprika 🌶');"
fi

echo
echo "---------------------------------------------------------------------"
echo "Read the ACCEPTED/REFUSED lines above. Every conversion the migration"
echo "needs must be ACCEPTED here before it is written, and any REFUSED line"
echo "carries the error TiDB gave - that is the constraint to design around."
echo "---------------------------------------------------------------------"
