-- Introspection only: lists the parent/child relationships worth checking for
-- orphaned rows. scripts/check-orphans.sh runs this, builds one LEFT JOIN per
-- row returned, and executes those. See that script for why.
--
-- Deliberately plain SQL. An earlier version generated the checks here with
-- GROUP_CONCAT + SELECT ... INTO @var + PREPARE, which TiDB rejects outright -
-- `SELECT ... INTO` is not supported there. Generating in the shell instead
-- keeps this file portable and readable, and the generated SQL inspectable.
--
-- Two sources, unioned:
--
--   declared   - an actual FOREIGN KEY in information_schema.
--   convention - a column named `<table>_id`, or `<something>_<table>_id`,
--                where `<table>` exists. Needed because a declared-only check
--                covers whatever the server happens to have registered, and
--                production has far fewer constraints than a database built
--                from migrations/*.sql. Checking only the declared ones would
--                have looked clean while missing much of the schema, which is
--                worse than not checking.
--
-- DATA_TYPE comes back because the caller skips a `<> 0` guard on non-integer
-- columns. MySQL coerces a string to 0 in that comparison, so applying it to
-- recipe_tag.tag_name would silently exclude every row from its own check.

SELECT k.TABLE_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME,
       col.DATA_TYPE, 'declared' AS source
FROM information_schema.KEY_COLUMN_USAGE k
JOIN information_schema.COLUMNS col
  ON col.TABLE_SCHEMA = k.TABLE_SCHEMA
 AND col.TABLE_NAME   = k.TABLE_NAME
 AND col.COLUMN_NAME  = k.COLUMN_NAME
WHERE k.TABLE_SCHEMA = DATABASE()
  AND k.REFERENCED_TABLE_NAME IS NOT NULL

UNION

SELECT c.TABLE_NAME, c.COLUMN_NAME, COALESCE(t1.TABLE_NAME, t2.TABLE_NAME), 'id',
       c.DATA_TYPE, 'convention' AS source
FROM information_schema.COLUMNS c
LEFT JOIN information_schema.TABLES t1
  ON t1.TABLE_SCHEMA = c.TABLE_SCHEMA
 AND t1.TABLE_NAME   = LEFT(c.COLUMN_NAME, CHAR_LENGTH(c.COLUMN_NAME) - 3)
LEFT JOIN information_schema.TABLES t2
  ON t2.TABLE_SCHEMA = c.TABLE_SCHEMA
 AND t2.TABLE_NAME   = SUBSTRING_INDEX(LEFT(c.COLUMN_NAME, CHAR_LENGTH(c.COLUMN_NAME) - 3), '_', -1)
WHERE c.TABLE_SCHEMA = DATABASE()
  AND c.COLUMN_NAME LIKE '%\_id'
  AND COALESCE(t1.TABLE_NAME, t2.TABLE_NAME) IS NOT NULL

ORDER BY 1, 2;
