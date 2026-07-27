-- Recipe data corrections agreed during Phase 2 curation review.
-- See specs/curation/phase-2-values.md section 7.
--
-- These are NOT normalisation. Each line's stored value doesn't say what the
-- recipe means - a bare count of chicken stock, a quarter of a millilitre of
-- lemon - and no Unit Size can fix that. Correcting them removes six
-- ingredients from the curation set entirely, which is why this runs before
-- the curated values in 025.
--
-- Pure DML, so the transaction is real: either all of it lands or none does.
-- Apply by piping this file directly, NOT through anything using `mysql
-- --force`, which would skip a failing statement and leave a partial fix.
--
-- Verify afterwards with the queries at the foot of this file.

START TRANSACTION;

-- 'orange' doesn't exist yet; two lines currently recorded against 'orange
-- juice' actually mean the fruit. Matches lemon's department (vegetables).
INSERT INTO `ingredient` (name) VALUES ('orange') ON DUPLICATE KEY UPDATE id = id;
INSERT INTO `ingredient_department` (department_id, ingredient_id)
SELECT d.id, i.id FROM `department` d, `ingredient` i
WHERE d.name = 'vegetables' AND i.name = 'orange'
  AND NOT EXISTS (SELECT 1 FROM `ingredient_department` x WHERE x.ingredient_id = i.id);

-- 1. Kung Pao Chicken - "1 chicken stock" is a splash, not a countable thing.
UPDATE `part` SET
  unit_id = (SELECT id FROM `unit` WHERE name = 'millilitre'),
  quantity = '30'
WHERE recipe_id = 70
  AND ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'chicken stock')
  AND unit_id = (SELECT id FROM `unit` WHERE name = '');

-- 2. Spicy Sausage Rice - "1 white wine" is a glass, not a bottle.
UPDATE `part` SET
  unit_id = (SELECT id FROM `unit` WHERE name = 'millilitre'),
  quantity = '100'
WHERE recipe_id = 94
  AND ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'white wine')
  AND unit_id = (SELECT id FROM `unit` WHERE name = '');

-- 3. Chicken Madras - quantity was 4, so not a bottle; 1 tablespoon.
UPDATE `part` SET
  unit_id = (SELECT id FROM `unit` WHERE name = 'tablespoon'),
  quantity = '1'
WHERE recipe_id = 720116
  AND ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'worcestershire sauce')
  AND unit_id = (SELECT id FROM `unit` WHERE name = '');

-- 4 & 5. Porchetta and the harissa salmon mean the juice of one / half an
-- orange - a count of oranges, not of cartons. Quantities are already right.
UPDATE `part` SET
  ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'orange')
WHERE recipe_id IN (89, 90141)
  AND ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'orange juice')
  AND unit_id = (SELECT id FROM `unit` WHERE name = '');

-- 6. Courgette fritters - 0.25 millilitre is a quarter of a millilitre, i.e.
-- nothing. It means a quarter of a lemon.
UPDATE `part` SET
  unit_id = (SELECT id FROM `unit` WHERE name = '')
WHERE recipe_id = 90139
  AND ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'lemon')
  AND unit_id = (SELECT id FROM `unit` WHERE name = 'millilitre');

-- 7. Pumpkin & Cauliflower Makhani - a wedge, not a whole pumpkin.
UPDATE `part` SET
  unit_id = (SELECT id FROM `unit` WHERE name = 'gram'),
  quantity = '500'
WHERE recipe_id = 810116
  AND ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'pumpkin')
  AND unit_id = (SELECT id FROM `unit` WHERE name = '');

-- 8. Chicken, Leek & Mushroom Pie - stock is measured by volume.
UPDATE `part` SET
  unit_id = (SELECT id FROM `unit` WHERE name = 'millilitre')
WHERE recipe_id = 15
  AND ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'chicken stock')
  AND unit_id = (SELECT id FROM `unit` WHERE name = 'gram');

COMMIT;

-- Verification - each of these should now return no rows:
--
--   SELECT 'stock/wine/worcestershire still counted' AS problem, i.name, p.quantity
--   FROM part p JOIN ingredient i ON i.id = p.ingredient_id JOIN unit u ON u.id = p.unit_id
--   WHERE u.name = '' AND i.name IN ('chicken stock','white wine','worcestershire sauce','orange juice','pumpkin');
--
--   SELECT 'lemon still in ml' AS problem FROM part p
--   JOIN ingredient i ON i.id = p.ingredient_id JOIN unit u ON u.id = p.unit_id
--   WHERE i.name = 'lemon' AND u.name <> '';
--
-- And 'orange' should now have exactly two lines:
--   SELECT p.quantity, r.name FROM part p JOIN ingredient i ON i.id = p.ingredient_id
--   JOIN recipe r ON r.id = p.recipe_id WHERE i.name = 'orange';
