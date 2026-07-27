-- Merge Ingredients that are the same thing. Resolves follow-ups.md #25.
--
-- Ingredients only combine on a Shopping List when they share a name, so a
-- near-duplicate splits one item into two lines permanently. Same shape as
-- migration 011, which did this by hand in 2020, and 023, which consolidated
-- garlic.
--
-- Done by hand rather than by similarity, deliberately. A script that merged on
-- string distance would also merge `coriander` with `ground coriander` and
-- `thyme` with `dried thyme` - fresh and ground are different purchases off
-- different shelves, which is exactly the distinction extract.js's prompt works
-- to preserve. The full list of pairs left alone is at the foot of this file.
--
-- Pure DML. Pipe directly, NOT through anything using `mysql --force`.

START TRANSACTION;

-- 'eggs' -> 'egg': 31 lines vs 2
UPDATE `part` SET ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'egg')
WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'eggs') x);
INSERT INTO `ingredient_department` (department_id, ingredient_id)
SELECT idp.department_id, (SELECT id FROM `ingredient` WHERE name = 'egg')
FROM `ingredient_department` idp
WHERE idp.ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'eggs') x)
  AND NOT EXISTS (SELECT 1 FROM (SELECT ingredient_id FROM `ingredient_department`) y
                  WHERE y.ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'egg'));
DELETE FROM `ingredient_department` WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'eggs') x);
DELETE FROM `ingredient_unit_size`  WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'eggs') x);
DELETE FROM `ingredient` WHERE name = 'eggs';

-- 'cloves' -> 'clove': the whole spice, in curry recipes - not garlic, which 023 already consolidated
UPDATE `part` SET ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'clove')
WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'cloves') x);
INSERT INTO `ingredient_department` (department_id, ingredient_id)
SELECT idp.department_id, (SELECT id FROM `ingredient` WHERE name = 'clove')
FROM `ingredient_department` idp
WHERE idp.ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'cloves') x)
  AND NOT EXISTS (SELECT 1 FROM (SELECT ingredient_id FROM `ingredient_department`) y
                  WHERE y.ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'clove'));
DELETE FROM `ingredient_department` WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'cloves') x);
DELETE FROM `ingredient_unit_size`  WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'cloves') x);
DELETE FROM `ingredient` WHERE name = 'cloves';

-- 'spring onion' -> 'spring onions': 15 lines vs 1; plural wins here because that is the established spelling
UPDATE `part` SET ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'spring onions')
WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'spring onion') x);
INSERT INTO `ingredient_department` (department_id, ingredient_id)
SELECT idp.department_id, (SELECT id FROM `ingredient` WHERE name = 'spring onions')
FROM `ingredient_department` idp
WHERE idp.ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'spring onion') x)
  AND NOT EXISTS (SELECT 1 FROM (SELECT ingredient_id FROM `ingredient_department`) y
                  WHERE y.ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'spring onions'));
DELETE FROM `ingredient_department` WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'spring onion') x);
DELETE FROM `ingredient_unit_size`  WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'spring onion') x);
DELETE FROM `ingredient` WHERE name = 'spring onion';

-- 'parsley leaves' -> 'parsley': 24 lines vs 1
UPDATE `part` SET ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'parsley')
WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'parsley leaves') x);
INSERT INTO `ingredient_department` (department_id, ingredient_id)
SELECT idp.department_id, (SELECT id FROM `ingredient` WHERE name = 'parsley')
FROM `ingredient_department` idp
WHERE idp.ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'parsley leaves') x)
  AND NOT EXISTS (SELECT 1 FROM (SELECT ingredient_id FROM `ingredient_department`) y
                  WHERE y.ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'parsley'));
DELETE FROM `ingredient_department` WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'parsley leaves') x);
DELETE FROM `ingredient_unit_size`  WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'parsley leaves') x);
DELETE FROM `ingredient` WHERE name = 'parsley leaves';

-- 'thyme leaf' -> 'thyme': 14 lines vs 1
UPDATE `part` SET ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'thyme')
WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'thyme leaf') x);
INSERT INTO `ingredient_department` (department_id, ingredient_id)
SELECT idp.department_id, (SELECT id FROM `ingredient` WHERE name = 'thyme')
FROM `ingredient_department` idp
WHERE idp.ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'thyme leaf') x)
  AND NOT EXISTS (SELECT 1 FROM (SELECT ingredient_id FROM `ingredient_department`) y
                  WHERE y.ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'thyme'));
DELETE FROM `ingredient_department` WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'thyme leaf') x);
DELETE FROM `ingredient_unit_size`  WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'thyme leaf') x);
DELETE FROM `ingredient` WHERE name = 'thyme leaf';

-- 'butter beans' -> 'butterbean': 2 lines vs 1; both curated, both shown as tins
UPDATE `part` SET ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'butterbean')
WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'butter beans') x);
INSERT INTO `ingredient_department` (department_id, ingredient_id)
SELECT idp.department_id, (SELECT id FROM `ingredient` WHERE name = 'butterbean')
FROM `ingredient_department` idp
WHERE idp.ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'butter beans') x)
  AND NOT EXISTS (SELECT 1 FROM (SELECT ingredient_id FROM `ingredient_department`) y
                  WHERE y.ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'butterbean'));
DELETE FROM `ingredient_department` WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'butter beans') x);
DELETE FROM `ingredient_unit_size`  WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'butter beans') x);
DELETE FROM `ingredient` WHERE name = 'butter beans';

-- 'oil ' -> ' oil': both whitespace-damaged; renamed to a clean 'oil' below
UPDATE `part` SET ingredient_id = (SELECT id FROM `ingredient` WHERE name = ' oil')
WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'oil ') x);
INSERT INTO `ingredient_department` (department_id, ingredient_id)
SELECT idp.department_id, (SELECT id FROM `ingredient` WHERE name = ' oil')
FROM `ingredient_department` idp
WHERE idp.ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'oil ') x)
  AND NOT EXISTS (SELECT 1 FROM (SELECT ingredient_id FROM `ingredient_department`) y
                  WHERE y.ingredient_id = (SELECT id FROM `ingredient` WHERE name = ' oil'));
DELETE FROM `ingredient_department` WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'oil ') x);
DELETE FROM `ingredient_unit_size`  WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'oil ') x);
DELETE FROM `ingredient` WHERE name = 'oil ';

-- Names with leading or trailing whitespace. UNIQUE(name) is
-- case-insensitive but not space-insensitive, so these could never match
-- an incoming ingredient - extract.js trims what arrives but compares it
-- against untrimmed stored names, so they would have collected new lines
-- forever.
UPDATE `ingredient` SET name = 'chicken' WHERE name = 'chicken ';  -- 200 gram in Chicken Saag - the meat
UPDATE `ingredient` SET name = 'bbq sauce' WHERE name = 'bbq sauce ';  -- 250 millilitre in Oven Baked Ribs
UPDATE `ingredient` SET name = 'oil' WHERE name = ' oil';  -- 3 tablespoon, twice, in curry recipes

-- Orphans: no Ingredient Lines at all, so nothing to repoint.
DELETE FROM `ingredient_department` WHERE ingredient_id IN (SELECT id FROM (SELECT id FROM `ingredient` WHERE name IN ('mixed seed', 'mustard seed', 'basil leaf', 'thyme sprig')) x);
DELETE FROM `ingredient` WHERE name IN ('mixed seed', 'mustard seed', 'basil leaf', 'thyme sprig');

-- Recompute the curated marker: a merge can move curated values onto a winner
-- that was not previously flagged.
UPDATE `ingredient` SET `curated` = TRUE
WHERE base_unit_id IS NOT NULL
   OR display_unit_id IS NOT NULL
   OR EXISTS (SELECT 1 FROM `ingredient_unit_size` s WHERE s.ingredient_id = ingredient.id);

COMMIT;

-- Deliberately NOT merged - these look similar and are different purchases:
--
--   coriander / ground coriander / coriander seeds
--   cumin / ground cumin / cumin seeds
--   thyme / dried thyme
--   turmeric / ground turmeric
--   chilli flakes / ground chilli flakes
--   egg / egg whites / egg yolk
--   onion / onion powder / onion seeds / onion paste / spring onions
--   ginger / ginger & garlic paste
--   chicken / chicken breast / chicken leg / chicken thigh /
--     chicken thighs (boneless) / chicken bones / chicken stock
--
-- Two worth a human eye, left alone because either answer is defensible:
--   * `chicken thigh` (2 lines) vs `chicken thighs (boneless)` (8) - bone-in and
--     boneless are different things to buy, but the shorter name may well mean
--     the boneless one.
--   * `chicken or ham stock` (1 line) - probably meant `chicken stock`, but that
--     is a recipe decision, not a catalog one.
--
-- Verification - should return no rows:
--   SELECT name FROM ingredient WHERE name <> TRIM(name);
--   SELECT LOWER(name), COUNT(*) FROM ingredient GROUP BY LOWER(name) HAVING COUNT(*) > 1;
