-- The Unit an Ingredient's combined total is *shown* in, as distinct from the
-- Base Unit it was added up in: "2 tins" rather than "800 g", because tins are
-- what you buy. See CONTEXT.md's Display Unit.
--
-- Optional - NULL means show the Base Unit, which is what everything does
-- today. Usually a Relative Unit (tin, packet, or the bare count), since those
-- are the ones you actually shop in.
--
-- This never affects the arithmetic, only the reading of it. The base total
-- stays visible alongside, so an approximate Unit Size can't quietly mislead:
-- if a tin is really 390g rather than the 400g assumed, "2 tins (800 g)" shows
-- its working.
ALTER TABLE `ingredient` ADD COLUMN `display_unit_id` INT NULL COMMENT 'unit to display combined totals in; NULL means show the base unit';
ALTER TABLE `ingredient` ADD CONSTRAINT `fk_ingredient_display_unit_id` FOREIGN KEY (`display_unit_id`) REFERENCES `unit` (`id`);

-- No values set here, for the same reason as 020: which Unit an Ingredient is
-- best shown in is a curated judgement, and lands with the Unit Sizes it
-- depends on.
