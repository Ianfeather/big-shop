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

-- 'spring onions' -> 'spring onion': the plural is the current majority (15
-- lines to 1), but extract.js's prompt mandates "Lowercase and singular" and
-- matchCanonicalIngredient compares exact strings with no plural handling, so
-- every future import produces the singular and would fragment again against a
-- plural catalog entry. The convention that governs what arrives next beats the
-- current majority.
UPDATE `part` SET ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'spring onion')
WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'spring onions') x);
INSERT INTO `ingredient_department` (department_id, ingredient_id)
SELECT idp.department_id, (SELECT id FROM `ingredient` WHERE name = 'spring onion')
FROM `ingredient_department` idp
WHERE idp.ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'spring onions') x)
  AND NOT EXISTS (SELECT 1 FROM (SELECT ingredient_id FROM `ingredient_department`) y
                  WHERE y.ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'spring onion'));
DELETE FROM `ingredient_department` WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'spring onions') x);
DELETE FROM `ingredient_unit_size`  WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'spring onions') x);
DELETE FROM `ingredient` WHERE name = 'spring onions';

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

-- 'thyme sprig' -> 'thyme': a unit wearing an ingredient's name. Its single
-- line is '1' with a blank unit in Potato & Leek Soup, so it repoints like any
-- other merge - the same treatment 'thyme leaf' gets above.
--
-- This sat in the orphan list below until a rehearsal against a production copy
-- caught it. Deleting it left the Ingredient Line pointing at an ingredient row
-- that no longer exists - no error, and the recipe simply loses its thyme, since
-- every read of a Recipe's lines joins `ingredient`.
UPDATE `part` SET ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'thyme')
WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'thyme sprig') x);
DELETE FROM `ingredient_department` WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'thyme sprig') x);
DELETE FROM `ingredient_unit_size`  WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'thyme sprig') x);
DELETE FROM `ingredient` WHERE name = 'thyme sprig';

-- Orphans: verified to have no Ingredient Lines at all, so nothing to repoint.
DELETE FROM `ingredient_department` WHERE ingredient_id IN (SELECT id FROM (SELECT id FROM `ingredient` WHERE name IN ('mixed seed', 'mustard seed', 'basil leaf')) x);
DELETE FROM `ingredient` WHERE name IN ('mixed seed', 'mustard seed', 'basil leaf');

-- Second round of merges, from a review of the "deliberately NOT merged" list
-- at the foot of this file. Ground-vs-whole is a real distinction and is kept
-- (`coriander seeds`, `cumin seeds`), but a bare spice name and its "ground "
-- prefix are the same jar, so those fragments are folded together.

-- 'ground cumin' -> 'cumin': the winner is the SMALLER side here (1 line vs 12)
-- and, unlike every other merge in this file, the loser is the curated one -
-- `ground cumin` carries the density and teaspoon Display Unit while `cumin`
-- carries nothing. The DELETE below would drop them, so they are copied across
-- first. IFNULL, not an unconditional SET, so this cannot overwrite a curated
-- value on the winner if one is ever added before this runs.
UPDATE `ingredient` SET
  base_unit_id = IFNULL(base_unit_id,
    (SELECT v FROM (SELECT base_unit_id AS v FROM `ingredient` WHERE name = 'ground cumin') a)),
  display_unit_id = IFNULL(display_unit_id,
    (SELECT v FROM (SELECT display_unit_id AS v FROM `ingredient` WHERE name = 'ground cumin') b))
WHERE name = 'cumin';
INSERT INTO `ingredient_unit_size` (ingredient_id, unit_id, size)
SELECT (SELECT id FROM `ingredient` WHERE name = 'cumin'), s.unit_id, s.size
FROM (SELECT ingredient_id, unit_id, size FROM `ingredient_unit_size`) s
WHERE s.ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'ground cumin') x)
  AND NOT EXISTS (SELECT 1 FROM (SELECT ingredient_id, unit_id FROM `ingredient_unit_size`) y
                  WHERE y.ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'cumin')
                    AND y.unit_id = s.unit_id);

-- 'ground cumin' -> 'cumin': 12 lines folded into 1; `cumin seeds` stays separate
UPDATE `part` SET ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'cumin')
WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'ground cumin') x);
INSERT INTO `ingredient_department` (department_id, ingredient_id)
SELECT idp.department_id, (SELECT id FROM `ingredient` WHERE name = 'cumin')
FROM `ingredient_department` idp
WHERE idp.ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'ground cumin') x)
  AND NOT EXISTS (SELECT 1 FROM (SELECT ingredient_id FROM `ingredient_department`) y
                  WHERE y.ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'cumin'));
DELETE FROM `ingredient_department` WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'ground cumin') x);
DELETE FROM `ingredient_unit_size`  WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'ground cumin') x);
DELETE FROM `ingredient` WHERE name = 'ground cumin';

-- 'ground turmeric' -> 'turmeric': 1 line into 15; turmeric is sold ground either way
UPDATE `part` SET ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'turmeric')
WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'ground turmeric') x);
INSERT INTO `ingredient_department` (department_id, ingredient_id)
SELECT idp.department_id, (SELECT id FROM `ingredient` WHERE name = 'turmeric')
FROM `ingredient_department` idp
WHERE idp.ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'ground turmeric') x)
  AND NOT EXISTS (SELECT 1 FROM (SELECT ingredient_id FROM `ingredient_department`) y
                  WHERE y.ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'turmeric'));
DELETE FROM `ingredient_department` WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'ground turmeric') x);
DELETE FROM `ingredient_unit_size`  WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'ground turmeric') x);
DELETE FROM `ingredient` WHERE name = 'ground turmeric';

-- 'ground chilli flakes' -> 'chilli flakes': 1 line into 9; flakes are flakes
UPDATE `part` SET ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'chilli flakes')
WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'ground chilli flakes') x);
INSERT INTO `ingredient_department` (department_id, ingredient_id)
SELECT idp.department_id, (SELECT id FROM `ingredient` WHERE name = 'chilli flakes')
FROM `ingredient_department` idp
WHERE idp.ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'ground chilli flakes') x)
  AND NOT EXISTS (SELECT 1 FROM (SELECT ingredient_id FROM `ingredient_department`) y
                  WHERE y.ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'chilli flakes'));
DELETE FROM `ingredient_department` WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'ground chilli flakes') x);
DELETE FROM `ingredient_unit_size`  WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'ground chilli flakes') x);
DELETE FROM `ingredient` WHERE name = 'ground chilli flakes';

-- 'chicken or ham stock' -> 'chicken stock': the single line was a recipe-level ambiguity, resolved in favour of chicken
UPDATE `part` SET ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'chicken stock')
WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'chicken or ham stock') x);
INSERT INTO `ingredient_department` (department_id, ingredient_id)
SELECT idp.department_id, (SELECT id FROM `ingredient` WHERE name = 'chicken stock')
FROM `ingredient_department` idp
WHERE idp.ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'chicken or ham stock') x)
  AND NOT EXISTS (SELECT 1 FROM (SELECT ingredient_id FROM `ingredient_department`) y
                  WHERE y.ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'chicken stock'));
DELETE FROM `ingredient_department` WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'chicken or ham stock') x);
DELETE FROM `ingredient_unit_size`  WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'chicken or ham stock') x);
DELETE FROM `ingredient` WHERE name = 'chicken or ham stock';

-- Recompute the curated marker: a merge can move curated values onto a winner
-- that was not previously flagged.
UPDATE `ingredient` SET `curated` = TRUE
WHERE base_unit_id IS NOT NULL
   OR display_unit_id IS NOT NULL
   OR EXISTS (SELECT 1 FROM `ingredient_unit_size` s WHERE s.ingredient_id = ingredient.id);

COMMIT;

-- Deliberately NOT merged - these look similar and are different purchases:
--
--   coriander / ground coriander / coriander seeds - fresh coriander (density
--     0.2, sold by the packet) really is a different purchase from the ground
--     spice (0.5, measured in spoons), so these stay apart
--   cumin seeds - whole, not the ground jar
--   thyme / dried thyme
--   egg / egg whites / egg yolk
--   onion / onion powder / onion seeds / onion paste / spring onion
--   ginger / ginger & garlic paste
--   chicken / chicken breast / chicken leg / chicken thigh /
--     chicken thighs (boneless) / chicken bones / chicken stock
--   `chicken thigh` (2 lines) vs `chicken thighs (boneless)` (8) - bone-in and
--     boneless are genuinely different things to buy.
--
-- Verification - should return no rows:
--   SELECT name FROM ingredient WHERE name <> TRIM(name);
--   SELECT LOWER(name), COUNT(*) FROM ingredient GROUP BY LOWER(name) HAVING COUNT(*) > 1;
