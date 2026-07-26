-- Teaches units what kind of measurement they are, so the Shopping List can
-- combine them safely. Until now CombineIngredients summed quantities keyed by
-- ingredient name alone, with unit not part of the key - "1 tablespoon garlic"
-- and "10 gram garlic" silently became "11" of whichever unit came first.
--
-- An Absolute Unit is the same size whatever it measures, so it carries a
-- `factor` into its dimension's base (gram for weight, millilitre for volume).
-- A Relative Unit's size depends on the ingredient - one tin of tomatoes and
-- one tin of coconut milk aren't the same thing - so it has no factor, and
-- gets a per-ingredient Unit Size in a later phase. See CONTEXT.md and
-- specs/unit-normalisation.md.
--
-- The column is `kind`, not `dimension`, deliberately: weight and volume are
-- dimensions but 'relative' is the absence of one, so naming the column after
-- its two well-behaved values would misdescribe the third. `kind` also still
-- reads correctly if the relative values are ever split into their real
-- sub-kinds (pack, portion, vague) - something the spec already gestures at,
-- since pinch/clove/tin can take a default Unit Size while packet/bottle/
-- slice/count cannot.
--
-- 'relative' is the default so every unit that isn't one of the six below -
-- including the blank-name count sentinel at id 1, and any unit a future
-- Recipe Import invents ("bunch", "sprig") - falls through correctly without
-- being enumerated here.
ALTER TABLE `unit` ADD COLUMN `kind` ENUM('weight','volume','relative') NOT NULL DEFAULT 'relative';
ALTER TABLE `unit` ADD COLUMN `factor` DECIMAL(12,4) NULL COMMENT 'absolute units only: one of this unit in gram / millilitre';

-- NOTE: this classification only matches rows that already exist. On a freshly
-- provisioned database every migration runs *before* any seed data, so these
-- UPDATEs match nothing there - docker/mysql-seed/dev-seed.sql sets the same
-- values inline at insert time instead. Keep the two in step.
UPDATE `unit` SET `kind` = 'weight', `factor` = 1    WHERE `name` = 'gram';
UPDATE `unit` SET `kind` = 'weight', `factor` = 1000 WHERE `name` = 'kilogram';
UPDATE `unit` SET `kind` = 'volume', `factor` = 1    WHERE `name` = 'millilitre';
UPDATE `unit` SET `kind` = 'volume', `factor` = 1000 WHERE `name` = 'litre';
UPDATE `unit` SET `kind` = 'volume', `factor` = 5    WHERE `name` = 'teaspoon';
UPDATE `unit` SET `kind` = 'volume', `factor` = 15   WHERE `name` = 'tablespoon';
