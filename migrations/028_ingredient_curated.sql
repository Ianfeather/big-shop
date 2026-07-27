-- Mark which Ingredients a person has curated, so classification can never
-- overwrite one. Resolves follow-ups.md #27.
--
-- Phase 4 guarded classification with "the Ingredient has no Ingredient Lines
-- yet", as a proxy for "nobody has considered this". The proxy leaks both ways:
--
--   * DeleteRecipe removes an Ingredient's `part` rows without removing the
--     Ingredient, so deleting the last Recipe that used something leaves it
--     curated but line-less - and the next import could overwrite the values a
--     person chose.
--   * It is also too strict. An Ingredient added last month with no curated
--     values, but used by a Recipe, can never be classified - even though there
--     is nothing to protect.
--
-- An explicit marker fixes both: "has a human touched this?" stops being
-- inferred. It is what the spec's Decisions section deferred, twice, on the
-- reasoning that NULL-vs-set expressed the rule - which it did not, because NULL
-- in base_unit_id means both "never curated" and "curated as the default, gram".
ALTER TABLE `ingredient` ADD COLUMN `curated` BOOLEAN NOT NULL DEFAULT FALSE
  COMMENT 'a person has chosen this ingredient catalog metadata; classification must not overwrite it';

-- Everything migrations 025, 026 and 027 touched was reviewed by a person.
--
-- NOTE: matches only rows that already exist, so on a freshly provisioned
-- database this updates nothing - migrations run before any seed data. See
-- docker/mysql-seed/dev-seed.sql, which sets `curated` inline for the same
-- reason it sets kind/factor inline.
UPDATE `ingredient` SET `curated` = TRUE
WHERE base_unit_id IS NOT NULL
   OR display_unit_id IS NOT NULL
   OR EXISTS (SELECT 1 FROM `ingredient_unit_size` s WHERE s.ingredient_id = ingredient.id);
