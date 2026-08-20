-- Every text column in the database, with the charset and collation it
-- actually has. Read by scripts/build-charset-checks.py, which turns the
-- non-utf8mb4 ones into a scan for text that cannot have survived the trip.
--
-- Tab-separated, no header - the caller runs it with -N.
SELECT
  c.TABLE_NAME,
  c.COLUMN_NAME,
  c.CHARACTER_SET_NAME,
  c.COLLATION_NAME,
  t.TABLE_COLLATION
FROM information_schema.COLUMNS c
JOIN information_schema.TABLES t
  ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
WHERE c.TABLE_SCHEMA = DATABASE()
  AND c.CHARACTER_SET_NAME IS NOT NULL
  AND t.TABLE_TYPE = 'BASE TABLE'
ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION;
