-- account_id gets the foreign keys it never had, on the three tables that
-- carry one directly.
--
-- `account_user.account_id` has referenced `account(id)` since 008_user.sql.
-- `recipe`, `list` and `shopping_list_event` never did: their column started
-- life as an Auth0 subject string (007_user.sql), was renamed rather than
-- retyped (008_user.sql), and only became an int in 039_account_id_int.sql.
-- Until that migration the types did not even match, so the constraint could
-- not have been declared.
--
-- Deliberately split from 039 rather than bundled with it. That migration
-- changed a query plan on the two largest tables in the schema and wanted to
-- be the only thing that did, so a regression stayed attributable to one
-- change. This is the other half.
--
-- ORDERING IS ALREADY CORRECT. service.deleteAccountTx empties recipe-owned
-- data, then `list`, then `shopping_list_event`, and only then runs
-- `DELETE FROM account` - so these constraints are satisfied by the existing
-- deletion path rather than tripped by it. See netlify-functions/recipes/
-- internal/pkg/service/account.go.
--
-- NO `ON DELETE` CLAUSE, matching fk_account_user_account_id. Plain RESTRICT
-- is the safer choice here precisely because the deletion path already removes
-- these rows explicitly: CASCADE would make those statements redundant, and a
-- future reordering bug would then delete rows silently instead of failing
-- loudly. The constraint is here to catch that, not to paper over it.
--
-- BEFORE APPLYING TO PRODUCTION, check for orphans. `ADD CONSTRAINT` fails
-- outright if any row points at an account that no longer exists, and
-- production declares far fewer constraints than a local database does, so
-- orphans are plausible rather than theoretical:
--
--   scripts/check-orphans.sh
--
-- or directly:
--
--   SELECT 'recipe' t, COUNT(*) FROM recipe r
--     LEFT JOIN account a ON a.id = r.account_id WHERE a.id IS NULL
--   UNION ALL SELECT 'list', COUNT(*) FROM list l
--     LEFT JOIN account a ON a.id = l.account_id WHERE a.id IS NULL
--   UNION ALL SELECT 'shopping_list_event', COUNT(*) FROM shopping_list_event s
--     LEFT JOIN account a ON a.id = s.account_id WHERE a.id IS NULL;
--
-- Failing is the right outcome if it happens. An orphaned row is data belonging
-- to an account that no longer exists, which is a deletion that did not finish;
-- decide what to do with it rather than declaring the constraint around it.

ALTER TABLE `recipe`
  ADD CONSTRAINT `fk_recipe_account_id`
  FOREIGN KEY (`account_id`) REFERENCES `account` (`id`);

ALTER TABLE `list`
  ADD CONSTRAINT `fk_list_account_id`
  FOREIGN KEY (`account_id`) REFERENCES `account` (`id`);

ALTER TABLE `shopping_list_event`
  ADD CONSTRAINT `fk_shopping_list_event_account_id`
  FOREIGN KEY (`account_id`) REFERENCES `account` (`id`);
