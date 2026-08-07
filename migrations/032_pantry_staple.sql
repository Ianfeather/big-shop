-- Mark which Ingredients are pantry staples, so the Shopping List can group
-- them away instead of the extractor dropping them from the Recipe.
--
-- Recipe Import used to omit salt, pepper, oil, flour, butter and sugar from a
-- Recipe entirely when they were used at seasoning scale. That decision was
-- right - nobody wants "1 tbsp olive oil" on every shopping list - but it was
-- taken in the wrong place. An omitted Ingredient is indistinguishable from a
-- failed extraction: the cook sees a Recipe missing three of its six lines and
-- has no way to tell "we decided you have this" from "we lost it". It also made
-- the Recipe itself permanently wrong, since nothing recorded what was dropped.
--
-- So the Recipe now keeps every Ingredient, and this flag moves the judgement to
-- where it is a presentation choice that can be undone with one tap.
--
-- Deliberately a plain boolean rather than a per-Ingredient threshold. A "how
-- small counts as seasoning" number is the more precise model - 200g of flour
-- for a cake is a real purchase - but it is also a curated judgement per
-- Ingredient, and grouping is now reversible in the UI, so being occasionally
-- over-eager costs a tap rather than a missing ingredient.
ALTER TABLE `ingredient` ADD COLUMN `pantry_staple` BOOLEAN NOT NULL DEFAULT FALSE
  COMMENT 'a near-universal store-cupboard basic; the shopping list groups these away by default';

-- The six categories the extractor used to drop, spelled out rather than
-- matched with LIKE.
--
-- The two ways to be wrong here are not symmetrical. Flagging something that is
-- not a staple hides a real purchase behind a collapsed group; failing to flag
-- one just leaves it on the list, where it is mild noise. So this errs towards
-- under-matching: '%oil%' would sweep up truffle oil and chilli oil, which are
-- ingredients you go out and buy, and no pattern distinguishes them from the
-- cooking oils. Anything missed can be added by a later migration.
--
-- `name` is matched case-insensitively by the column's collation, which is what
-- lets one lowercase list cover both production's extractor-generated names and
-- the title-cased ones in docker/mysql-seed/dev-seed.sql.
--
-- NOTE: matches only rows that already exist, so on a freshly provisioned
-- database this updates nothing - migrations run before any seed data. The dev
-- seed sets the flag inline for the same reason (see 028's note).
UPDATE `ingredient` SET `pantry_staple` = TRUE WHERE name IN (
  -- salt
  'salt', 'sea salt', 'table salt', 'fine sea salt', 'flaky sea salt', 'kosher salt',
  -- pepper
  'pepper', 'black pepper', 'white pepper', 'ground black pepper',
  'freshly ground black pepper', 'black peppercorn',
  -- cooking oil (not the flavouring oils - see above)
  'oil', 'cooking oil', 'olive oil', 'extra virgin olive oil', 'vegetable oil',
  'sunflower oil', 'rapeseed oil', 'groundnut oil', 'canola oil',
  -- flour
  'flour', 'plain flour', 'all-purpose flour', 'self-raising flour', 'self raising flour',
  'strong white flour', 'strong white bread flour',
  -- butter
  'butter', 'unsalted butter', 'salted butter',
  -- sugar
  'sugar', 'caster sugar', 'golden caster sugar', 'granulated sugar', 'brown sugar',
  'light brown sugar', 'dark brown sugar', 'light brown soft sugar', 'demerara sugar',
  'icing sugar'
);

-- `curated` is deliberately NOT set here. It means "a person chose this
-- Ingredient's measurement metadata", and marking butter a staple says nothing
-- about its Base Unit - setting it would silently freeze classification for
-- every Ingredient in the list above. The flag protects itself instead:
-- classification only ever sets it TRUE, so a re-proposal is a no-op and it can
-- never be flipped back off by an import.
