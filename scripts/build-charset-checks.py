#!/usr/bin/env python3
"""Turn the column list from check-charsets.sql into a scan for damaged text.

Reads tab-separated rows on stdin, writes SQL on stdout. Split out of
check-charsets.sh for the same reason build-orphan-checks.py is: so the
generated SQL can be read on its own (`... | scripts/build-charset-checks.py`)
rather than only ever being piped into a database.

Only columns on a table that is not utf8mb4 are scanned. Two things are
counted per column:

  mojibake  - the fingerprint of UTF-8 bytes that were stored into a latin1
              column and are now being read back as latin1. A multi-byte
              character becomes two or three latin1 characters, and the first
              of them is almost always U+00C3 (A-tilde), U+00C2 (A-circumflex)
              or the sequence 'a-circumflex, euro'. Text that was always
              correct does not contain those next to another high character.

  non_ascii - any character above U+007F at all. Not damage in itself, but it
              is the population at risk: a column with no non-ASCII text has
              nothing that a charset change could corrupt, which turns the
              question from "is this a live bug" into "is this latent".
"""
import sys

# Read as latin1, a UTF-8 two-byte character starts 0xC3 or 0xC2, and the
# common "smart quote" three-byte ones start 0xE2 0x80 -> 'a-circumflex' +
# 'euro'. Requiring a second high character after it keeps genuinely-latin1
# text (a lone 'A-tilde' in a name) from counting as damage.
MOJIBAKE = r'(Ã[\\x80-\\xBF])|(Â[\\x80-\\xBF])|(â€)'
NON_ASCII = r'[^\\x00-\\x7F]'

checks = []
for line in sys.stdin:
    parts = line.rstrip('\n').split('\t')
    if len(parts) != 5:
        continue
    table, column, charset, collation, table_collation = parts
    if charset == 'utf8mb4':
        continue
    label = f'{table}.{column} [{collation}]'
    checks.append(
        f"SELECT '{label}' AS col,\n"
        f"       COUNT(*) AS rows_total,\n"
        f"       SUM(`{column}` REGEXP '{NON_ASCII}') AS non_ascii,\n"
        f"       SUM(`{column}` REGEXP '{MOJIBAKE}') AS mojibake\n"
        f"  FROM `{table}`"
    )

if not checks:
    print("SELECT 'every text column is already utf8mb4 - nothing to scan' AS col, "
          "0 AS rows_total, 0 AS non_ascii, 0 AS mojibake;")
    sys.exit(0)

print('\nUNION ALL\n'.join(checks) + ';')
