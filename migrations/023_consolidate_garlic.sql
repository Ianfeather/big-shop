-- Consolidate three ingredients that are all garlic into one.
-- See specs/curation/phase-2-values.md section 8, and follow-ups.md #25.
--
-- Before: "garlic" (5 lines), "garlic clove" (75), "garlic cloves" (2) - 82
-- lines for one thing, which never combine on a Shopping List because
-- ingredients only combine when they share a name.
--
-- After: one ingredient, "garlic", measured in "clove". The ingredient is
-- garlic; clove is the unit. Because it ends up with a single Unit it can
-- never collide, so it needs no Unit Size at all - which is why garlic is
-- absent from 025.
--
-- Same shape as migrations/011_plurals.sql, which did this by hand in 2020.
--
-- Pure DML, so the transaction is real. Pipe this file directly, NOT through
-- anything using `mysql --force`.

START TRANSACTION;

-- Quantities on the bare-count lines are already whole cloves (1-15), so they
-- carry over unchanged - only the Unit is wrong.
UPDATE `part` SET
  ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'garlic'),
  unit_id = (SELECT id FROM `unit` WHERE name = 'clove')
WHERE ingredient_id IN (SELECT id FROM `ingredient` WHERE name IN ('garlic clove', 'garlic cloves'))
  AND unit_id IN (SELECT id FROM `unit` WHERE name IN ('', 'clove'));

-- A tablespoon of minced garlic is about 3 cloves.
UPDATE `part` SET
  ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'garlic'),
  unit_id = (SELECT id FROM `unit` WHERE name = 'clove'),
  quantity = '3'
WHERE ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'garlic clove')
  AND unit_id = (SELECT id FROM `unit` WHERE name = 'tablespoon');

-- ...and a teaspoon is about 1, not 3. Deliberately different from the line
-- above: applying 3 uniformly would have tripled this recipe's garlic.
UPDATE `part` SET
  ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'garlic'),
  unit_id = (SELECT id FROM `unit` WHERE name = 'clove'),
  quantity = '1'
WHERE ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'garlic clove')
  AND unit_id = (SELECT id FROM `unit` WHERE name = 'teaspoon');

-- The one pre-existing "garlic" line that used a bare count.
UPDATE `part` SET
  unit_id = (SELECT id FROM `unit` WHERE name = 'clove')
WHERE ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'garlic')
  AND unit_id = (SELECT id FROM `unit` WHERE name = '');

-- Move the department. "garlic clove" is in vegetables; "garlic" has none at
-- all, so without this step garlic loses its grouping and sorts to the bottom
-- of the Shopping List with the ungrouped items. Easy to miss.
INSERT INTO `ingredient_department` (department_id, ingredient_id)
SELECT idp.department_id, (SELECT id FROM `ingredient` WHERE name = 'garlic')
FROM `ingredient_department` idp
WHERE idp.ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'garlic clove')
  AND NOT EXISTS (
    SELECT 1 FROM `ingredient_department` x
    WHERE x.ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'garlic')
  );

DELETE FROM `ingredient_department`
WHERE ingredient_id IN (SELECT id FROM `ingredient` WHERE name IN ('garlic clove', 'garlic cloves'));

-- Safe now: the FK from part.ingredient_id has nothing left pointing here.
DELETE FROM `ingredient` WHERE name IN ('garlic clove', 'garlic cloves');

COMMIT;

-- Verification:
--
--   -- should be exactly one row: garlic | clove | 82
--   SELECT i.name, u.name, COUNT(*) FROM part p
--   JOIN ingredient i ON i.id = p.ingredient_id JOIN unit u ON u.id = p.unit_id
--   WHERE i.name LIKE 'garlic%' GROUP BY i.name, u.name;
--
--   -- should be 'vegetables', not '(none)'
--   SELECT IFNULL(d.name,'(none)') FROM ingredient i
--   LEFT JOIN ingredient_department idp ON idp.ingredient_id = i.id
--   LEFT JOIN department d ON d.id = idp.department_id WHERE i.name = 'garlic';
