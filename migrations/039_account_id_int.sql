-- account_id becomes an int on the three tables where it was still a string.
--
-- `account.id` and `account_user.account_id` have always been `int`. But
-- `recipe.account_id`, `list.account_id` and `shopping_list_event.account_id`
-- were `varchar(255)`: 007_user.sql widened `recipe.user_id`/`list.user_id` to
-- hold an Auth0 subject, 008_user.sql renamed the column to `account_id`
-- without retyping it, and 015_shopping_list_history.sql copied the shape when
-- it created `shopping_list_event`.
--
-- The Go code has passed an int to all of them throughout. It works, because
-- MySQL coerces - but it coerces THE COLUMN, NOT THE VALUE, and that is the
-- whole problem:
--
--   * The index is unusable. Comparing a varchar column to a number converts
--     every row's value to a number, so `WHERE account_id = 7` is a full table
--     scan. `list` and `shopping_list_event` are the two largest tables in the
--     schema, and account deletion runs an unfiltered
--     `DELETE ... WHERE account_id = ?` against both.
--   * Matching is loose. '07', ' 7' and '7.0' all equal 7 under numeric
--     coercion. Nothing writes those today, so this is latent, not live.
--
-- No application change accompanies this: every call site already passes an
-- int, and the driver's `interpolateParams=true` renders it unquoted.
--
-- BEFORE APPLYING TO PRODUCTION, confirm every value is a plain integer. A row
-- still holding an un-migrated Auth0 subject would make the ALTERs below fail:
--
--   SELECT 'recipe' t, COUNT(*) FROM recipe             WHERE account_id NOT REGEXP '^[0-9]+$'
--   UNION ALL
--   SELECT 'list',      COUNT(*) FROM list              WHERE account_id NOT REGEXP '^[0-9]+$'
--   UNION ALL
--   SELECT 'sle',       COUNT(*) FROM shopping_list_event WHERE account_id NOT REGEXP '^[0-9]+$';
--
-- Failing is the correct outcome if it happens - under strict mode (the
-- default on both MySQL 8 and TiDB) a non-numeric value aborts the whole ALTER
-- and leaves the table untouched, rather than silently coercing the row to 0
-- and orphaning it. Do not work around it; migrate the value first.
--
-- Foreign keys to `account(id)` are deliberately NOT added here. The retype is
-- the fix for the two problems above, and doing it alone keeps a query-plan
-- change attributable to one migration. The deletion path in
-- service.deleteAccountTx already empties all three tables before
-- `DELETE FROM account`, so the constraints would be satisfiable - see the
-- board item for that follow-up.

ALTER TABLE `recipe` MODIFY `account_id` int NOT NULL COMMENT 'account that owns this recipe';

ALTER TABLE `list` MODIFY `account_id` int NOT NULL COMMENT 'account this list belongs to';

-- `shopping_list_event` also carries idx_account_date (account_id, created_at)
-- and idx_recipe_usage (account_id, recipe_id, created_at). Both survive the
-- MODIFY, and both become usable by the queries in service/history.go for the
-- first time.
ALTER TABLE `shopping_list_event` MODIFY `account_id` int NOT NULL COMMENT 'account that made the change';
