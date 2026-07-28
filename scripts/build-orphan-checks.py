#!/usr/bin/env python3
"""Turn the relationship list from check-orphans.sql into one LEFT JOIN per
relationship. Reads tab-separated rows on stdin, writes SQL on stdout.

Split out of check-orphans.sh so the generated SQL can be inspected on its own
(`... | scripts/build-orphan-checks.py`) rather than only ever being piped
straight into a database.
"""
import sys

INTEGER_TYPES = {'int', 'bigint', 'smallint', 'tinyint', 'mediumint'}

# One row per (child table, child column). A relationship found by both rules
# is the same check either way; keep the declared label since it is the
# stronger statement about intent.
relationships = {}
for line in sys.stdin:
    parts = line.rstrip('\n').split('\t')
    if len(parts) != 6:
        continue
    child, column, parent, parent_column, data_type, source = parts
    key = (child, column)
    if key not in relationships or source == 'declared':
        relationships[key] = (parent, parent_column, data_type, source)

if not relationships:
    print("SELECT 'NO RELATIONSHIPS FOUND - the introspection query returned nothing' AS broken_reference, 0 AS orphan_rows;")
    sys.exit(0)

checks = []
for (child, column), (parent, parent_column, data_type, source) in sorted(relationships.items()):
    # NULL is a legitimately absent reference. So is 0: ids start at 1, and
    # pages/list.tsx writes recipe_id 0 as the placeholder on an Extra Item,
    # which is not an orphan. The guard is skipped on non-integer columns
    # because MySQL would coerce the string side to 0 and drop every row.
    guards = [f'c.`{column}` IS NOT NULL']
    if data_type in INTEGER_TYPES:
        guards.append(f'c.`{column}` <> 0')
    guards.append(f'p.`{parent_column}` IS NULL')

    label = f'{child}.{column} -> {parent}.{parent_column} [{source}]'
    checks.append(
        f"SELECT '{label}' AS broken_reference, COUNT(*) AS orphan_rows\n"
        f"  FROM `{child}` c LEFT JOIN `{parent}` p ON p.`{parent_column}` = c.`{column}`\n"
        f" WHERE {' AND '.join(guards)}"
    )

print('SELECT * FROM (\n' + '\nUNION ALL\n'.join(checks) + '\n) t WHERE orphan_rows > 0;')
