-- Schema foundations for spec/unit-normalisation.md (Phase 1).
--
-- unit.unit_type + unit.base_factor let the aggregation code convert any unit
-- to a common base (grams for weight, millilitres for volume, 1 for count)
-- via data instead of the two hardcoded gram/kilogram + millilitre/litre maps
-- that lived in list.go.
ALTER TABLE `unit`
  ADD COLUMN `unit_type` varchar(10) NOT NULL DEFAULT 'count' COMMENT 'weight | volume | count',
  ADD COLUMN `base_factor` decimal(12,4) NOT NULL DEFAULT 1 COMMENT 'how many of the unit_type''s base unit (gram for weight, millilitre for volume, 1 for count) one of this unit represents';

-- average_weight_grams enables combining a count-typed quantity (e.g. "3
-- tomatoes") with a weight-typed quantity (e.g. "150g tomatoes") for the same
-- ingredient. preferred_unit_id is the unit the shopping list should display
-- this ingredient in, when set.
ALTER TABLE `ingredient`
  ADD COLUMN `average_weight_grams` decimal(10,2) DEFAULT NULL COMMENT 'average weight in grams of a single count-unit item, e.g. one tomato',
  ADD COLUMN `preferred_unit_id` int DEFAULT NULL COMMENT 'foreign key into unit table; unit to normalize this ingredient to on the shopping list',
  ADD CONSTRAINT `fk_ingredient_preferred_unit_id` FOREIGN KEY (`preferred_unit_id`) REFERENCES `unit` (`id`);

-- Classify the known seeded units (docker/mysql-seed/dev-seed.sql). Anything
-- not listed here keeps the column defaults (unit_type='count', base_factor=1),
-- which is correct for irreducible container/count units like 'packet' or 'tin'.
UPDATE `unit` SET unit_type = 'weight', base_factor = 1 WHERE name = 'gram';
UPDATE `unit` SET unit_type = 'weight', base_factor = 1000 WHERE name = 'kilogram';
UPDATE `unit` SET unit_type = 'volume', base_factor = 1 WHERE name = 'millilitre';
UPDATE `unit` SET unit_type = 'volume', base_factor = 1000 WHERE name = 'litre';
UPDATE `unit` SET unit_type = 'volume', base_factor = 5 WHERE name = 'teaspoon';
UPDATE `unit` SET unit_type = 'volume', base_factor = 15 WHERE name = 'tablespoon';
