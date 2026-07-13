-- One Department per Ingredient is a domain rule (see CONTEXT.md), but this
-- join table is structurally many-to-many today. This constraint enforces
-- the rule going forward.
--
-- Before running against a database with existing data, check for
-- pre-existing duplicates first, since this will fail otherwise:
--   SELECT ingredient_id, COUNT(*) FROM ingredient_department GROUP BY ingredient_id HAVING COUNT(*) > 1;
ALTER TABLE ingredient_department ADD UNIQUE (ingredient_id);
