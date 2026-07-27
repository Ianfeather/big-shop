-- Report rows whose foreign key points at a parent row that no longer exists.
--
-- Derived from information_schema rather than hardcoded, so it keeps covering
-- the whole schema as constraints are added - a hand-written list goes stale
-- silently, which is exactly the failure mode this is meant to catch.
--
-- Why this exists: TiDB does not necessarily enforce foreign keys, so a data
-- migration that deletes a parent row can leave children dangling with no
-- error at all. The same statement against a MySQL database built from
-- migrations/*.sql errors instead, because the constraints there are enforced
-- (all NO ACTION). Migration 029 hit this: it deleted `thyme sprig`, which
-- still had an Ingredient Line, and Potato & Leek Soup silently lost its thyme.
--
-- Reads nothing but counts; safe to run against production at any time.
--
--   docker run --rm -i -e MYSQL_PWD="$PW" mysql:8.0 \
--     mysql -h HOST -P 4000 -u USER --ssl-mode=REQUIRED bigshop \
--     < scripts/check-orphans.sql
--
-- No rows returned means no orphans. Run it before and after any migration
-- that deletes from a parent table.

-- Enforcement status. `declared_fks = 0` is the important one: it means this
-- server is not tracking constraints, so nothing below can be derived and
-- nothing was ever protecting these tables.
SELECT VERSION() AS server,
       @@foreign_key_checks AS fk_checks_session,
       (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL) AS declared_fks;

SET SESSION group_concat_max_len = 1000000;

-- One LEFT JOIN per foreign key. `IS NOT NULL` on the child column matters:
-- nullable references (ingredient.base_unit_id, ingredient.display_unit_id)
-- are legitimately empty and must not count as orphans.
SELECT GROUP_CONCAT(
         CONCAT("SELECT '", k.TABLE_NAME, '.', k.COLUMN_NAME,
                ' -> ', k.REFERENCED_TABLE_NAME, '.', k.REFERENCED_COLUMN_NAME,
                "' AS broken_reference, COUNT(*) AS orphan_rows",
                ' FROM `', k.TABLE_NAME, '` c',
                ' LEFT JOIN `', k.REFERENCED_TABLE_NAME, '` p',
                ' ON p.`', k.REFERENCED_COLUMN_NAME, '` = c.`', k.COLUMN_NAME, '`',
                ' WHERE c.`', k.COLUMN_NAME, '` IS NOT NULL',
                '   AND p.`', k.REFERENCED_COLUMN_NAME, '` IS NULL')
         SEPARATOR ' UNION ALL ')
INTO @body
FROM information_schema.KEY_COLUMN_USAGE k
WHERE k.TABLE_SCHEMA = DATABASE()
  AND k.REFERENCED_TABLE_NAME IS NOT NULL;

SET @sql = IF(@body IS NULL,
  "SELECT 'NO FOREIGN KEYS DECLARED IN THIS SCHEMA - no checks could be derived' AS broken_reference, 0 AS orphan_rows",
  CONCAT('SELECT * FROM (', @body, ') t WHERE orphan_rows > 0'));

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
