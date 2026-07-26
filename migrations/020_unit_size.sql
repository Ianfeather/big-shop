-- Adds the data that lets a Relative Unit be converted for a specific
-- Ingredient: a Unit Size answers "how much is one <unit> of <ingredient>, in
-- that Ingredient's Base Unit". See CONTEXT.md and docs/adr/0004.
--
-- The point of the one relation is that average item weight ("one potato is
-- 180g"), pack size ("one tin of coconut milk is 400ml") and density ("one
-- tablespoon of flour is 8g") are the same fact asked about different Units,
-- so they share a mechanism rather than being three features.

-- Where a Unit's size genuinely doesn't vary by Ingredient - a pinch is a pinch
-- - it can carry a default. Units whose size really does vary (packet, bottle,
-- slice, and the blank count sentinel) declare none and stay per-Ingredient.
-- NULL means "no default"; a per-Ingredient row always wins over this.
ALTER TABLE `unit` ADD COLUMN `default_size` DECIMAL(12,4) NULL COMMENT 'relative units only: default Unit Size, overridden per ingredient';

-- The Absolute Unit an Ingredient's quantities are added up in: gram for things
-- bought by weight, millilitre for things bought by volume. NULL is read as
-- gram, so this only needs setting for the liquids.
ALTER TABLE `ingredient` ADD COLUMN `base_unit_id` INT NULL COMMENT 'absolute unit (gram/millilitre) this ingredient normalises to; NULL means gram';
ALTER TABLE `ingredient` ADD CONSTRAINT `fk_ingredient_base_unit_id` FOREIGN KEY (`base_unit_id`) REFERENCES `unit` (`id`);

-- One row per Ingredient-and-Unit pair. Absent is a normal state, not an error:
-- until a row exists the two quantities simply stay as separate Amounts on the
-- Shopping List, which is what Phase 1 already does.
CREATE TABLE `ingredient_unit_size` (
  `ingredient_id` int NOT NULL,
  `unit_id` int NOT NULL,
  `size` DECIMAL(12,4) NOT NULL COMMENT 'one <unit> of <ingredient>, in that ingredient base unit',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`ingredient_id`, `unit_id`),
  CONSTRAINT `fk_ius_ingredient_id` FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient` (`id`),
  CONSTRAINT `fk_ius_unit_id` FOREIGN KEY (`unit_id`) REFERENCES `unit` (`id`)
);

-- No values are set here. Unlike 019's classification of the six Absolute
-- Units - which is a fixed fact about the metric system - Unit Sizes are
-- curated judgements about real ingredients, and they land in their own
-- migration once drafted and reviewed. Leaving them absent is safe: every
-- Ingredient keeps behaving exactly as it does today until a row appears.
