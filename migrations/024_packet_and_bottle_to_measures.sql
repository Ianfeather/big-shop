-- Convert every `packet` and `bottle` line to a real measure.
-- See specs/curation/phase-2-values.md section 4.
--
-- `packet` isn't a size, it's the absence of one: "1 packet coriander" never
-- recorded whether that was 30g or 100g, both of which exist on the shelf. So
-- this isn't destroying a faithful record, it's supplying something that was
-- never captured. A Unit Size would only have hidden the same guess behind the
-- aggregation.
--
-- The deciding argument is automatic ordering: from grams you can work out
-- which pack size to buy, and you can still choose to display packets. From
-- "1 packet" you can do neither without re-guessing. Grams are the recoverable
-- direction.
--
-- Consequently `packet` and `bottle` are NOT set as Display Units in 025 -
-- showing "2 packet" is confidently unhelpful when packets come in several
-- sizes.
--
-- Note 10 of these ingredients are used by one recipe each and never collide
-- with another Unit, so converting them changes no Shopping List today. They
-- are included for consistency, and so an ordering system later sees real
-- quantities throughout.
--
-- Quantities multiply: (quantity + 0) coerces the varchar to a number, so a
-- line reading 2 packets becomes twice the pack size. All current quantities
-- are 1 or 2, so every result is a whole number.
--
-- Pure DML, so the transaction is real. Pipe this file directly, NOT through
-- anything using `mysql --force`.

START TRANSACTION;


-- ---- packet ----

UPDATE `part` SET
  quantity = CAST((quantity + 0) * 250 AS CHAR),
  unit_id = (SELECT id FROM `unit` WHERE name = 'gram')
WHERE ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'asparagus')
  AND unit_id = (SELECT id FROM `unit` WHERE name = 'packet');

UPDATE `part` SET
  quantity = CAST((quantity + 0) * 175 AS CHAR),
  unit_id = (SELECT id FROM `unit` WHERE name = 'gram')
WHERE ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'baby corn')
  AND unit_id = (SELECT id FROM `unit` WHERE name = 'packet');

UPDATE `part` SET
  quantity = CAST((quantity + 0) * 200 AS CHAR),
  unit_id = (SELECT id FROM `unit` WHERE name = 'gram')
WHERE ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'cashew nuts')
  AND unit_id = (SELECT id FROM `unit` WHERE name = 'packet');

UPDATE `part` SET
  quantity = CAST((quantity + 0) * 250 AS CHAR),
  unit_id = (SELECT id FROM `unit` WHERE name = 'gram')
WHERE ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'cherry tomato')
  AND unit_id = (SELECT id FROM `unit` WHERE name = 'packet');

  -- quantity is 2, so 500g
UPDATE `part` SET
  quantity = CAST((quantity + 0) * 250 AS CHAR),
  unit_id = (SELECT id FROM `unit` WHERE name = 'gram')
WHERE ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'cooked rice')
  AND unit_id = (SELECT id FROM `unit` WHERE name = 'packet');

UPDATE `part` SET
  quantity = CAST((quantity + 0) * 30 AS CHAR),
  unit_id = (SELECT id FROM `unit` WHERE name = 'gram')
WHERE ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'coriander')
  AND unit_id = (SELECT id FROM `unit` WHERE name = 'packet');

UPDATE `part` SET
  quantity = CAST((quantity + 0) * 500 AS CHAR),
  unit_id = (SELECT id FROM `unit` WHERE name = 'gram')
WHERE ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'custard')
  AND unit_id = (SELECT id FROM `unit` WHERE name = 'packet');

UPDATE `part` SET
  quantity = CAST((quantity + 0) * 30 AS CHAR),
  unit_id = (SELECT id FROM `unit` WHERE name = 'gram')
WHERE ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'dill')
  AND unit_id = (SELECT id FROM `unit` WHERE name = 'packet');

UPDATE `part` SET
  quantity = CAST((quantity + 0) * 200 AS CHAR),
  unit_id = (SELECT id FROM `unit` WHERE name = 'gram')
WHERE ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'extra firm smoked tofu')
  AND unit_id = (SELECT id FROM `unit` WHERE name = 'packet');

  -- duplicate of parsley - see follow-ups.md #25
UPDATE `part` SET
  quantity = CAST((quantity + 0) * 30 AS CHAR),
  unit_id = (SELECT id FROM `unit` WHERE name = 'gram')
WHERE ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'flat-leaf parsley')
  AND unit_id = (SELECT id FROM `unit` WHERE name = 'packet');

UPDATE `part` SET
  quantity = CAST((quantity + 0) * 750 AS CHAR),
  unit_id = (SELECT id FROM `unit` WHERE name = 'gram')
WHERE ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'french fries')
  AND unit_id = (SELECT id FROM `unit` WHERE name = 'packet');

UPDATE `part` SET
  quantity = CAST((quantity + 0) * 200 AS CHAR),
  unit_id = (SELECT id FROM `unit` WHERE name = 'gram')
WHERE ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'green beans')
  AND unit_id = (SELECT id FROM `unit` WHERE name = 'packet');

UPDATE `part` SET
  quantity = CAST((quantity + 0) * 250 AS CHAR),
  unit_id = (SELECT id FROM `unit` WHERE name = 'gram')
WHERE ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'lasagne sheets')
  AND unit_id = (SELECT id FROM `unit` WHERE name = 'packet');

UPDATE `part` SET
  quantity = CAST((quantity + 0) * 500 AS CHAR),
  unit_id = (SELECT id FROM `unit` WHERE name = 'gram')
WHERE ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'linguine')
  AND unit_id = (SELECT id FROM `unit` WHERE name = 'packet');

UPDATE `part` SET
  quantity = CAST((quantity + 0) * 130 AS CHAR),
  unit_id = (SELECT id FROM `unit` WHERE name = 'gram')
WHERE ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'pancetta')
  AND unit_id = (SELECT id FROM `unit` WHERE name = 'packet');

UPDATE `part` SET
  quantity = CAST((quantity + 0) * 30 AS CHAR),
  unit_id = (SELECT id FROM `unit` WHERE name = 'gram')
WHERE ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'parsley')
  AND unit_id = (SELECT id FROM `unit` WHERE name = 'packet');

UPDATE `part` SET
  quantity = CAST((quantity + 0) * 200 AS CHAR),
  unit_id = (SELECT id FROM `unit` WHERE name = 'gram')
WHERE ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'prawns')
  AND unit_id = (SELECT id FROM `unit` WHERE name = 'packet');

  -- quantity is 2, so 540
UPDATE `part` SET
  quantity = CAST((quantity + 0) * 270 AS CHAR),
  unit_id = (SELECT id FROM `unit` WHERE name = 'gram')
WHERE ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'round gow gee wrappers')
  AND unit_id = (SELECT id FROM `unit` WHERE name = 'packet');

UPDATE `part` SET
  quantity = CAST((quantity + 0) * 150 AS CHAR),
  unit_id = (SELECT id FROM `unit` WHERE name = 'gram')
WHERE ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'shiitake mushrooms')
  AND unit_id = (SELECT id FROM `unit` WHERE name = 'packet');

UPDATE `part` SET
  quantity = CAST((quantity + 0) * 250 AS CHAR),
  unit_id = (SELECT id FROM `unit` WHERE name = 'gram')
WHERE ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'spinach')
  AND unit_id = (SELECT id FROM `unit` WHERE name = 'packet');

UPDATE `part` SET
  quantity = CAST((quantity + 0) * 200 AS CHAR),
  unit_id = (SELECT id FROM `unit` WHERE name = 'gram')
WHERE ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'tenderstem broccoli')
  AND unit_id = (SELECT id FROM `unit` WHERE name = 'packet');

UPDATE `part` SET
  quantity = CAST((quantity + 0) * 200 AS CHAR),
  unit_id = (SELECT id FROM `unit` WHERE name = 'gram')
WHERE ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'tortilla chips')
  AND unit_id = (SELECT id FROM `unit` WHERE name = 'packet');

UPDATE `part` SET
  quantity = CAST((quantity + 0) * 500 AS CHAR),
  unit_id = (SELECT id FROM `unit` WHERE name = 'gram')
WHERE ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'tortilla dough')
  AND unit_id = (SELECT id FROM `unit` WHERE name = 'packet');


-- ---- bottle ----

  -- GUESS - note the trailing space in the name, see follow-ups.md #25
UPDATE `part` SET
  quantity = CAST((quantity + 0) * 250 AS CHAR),
  unit_id = (SELECT id FROM `unit` WHERE name = 'millilitre')
WHERE ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'bbq sauce ')
  AND unit_id = (SELECT id FROM `unit` WHERE name = 'bottle');

  -- GUESS - a packet of cider is odd data; check recipe 34
UPDATE `part` SET
  quantity = CAST((quantity + 0) * 500 AS CHAR),
  unit_id = (SELECT id FROM `unit` WHERE name = 'millilitre')
WHERE ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'cider')
  AND unit_id = (SELECT id FROM `unit` WHERE name = 'bottle');

UPDATE `part` SET
  quantity = CAST((quantity + 0) * 250 AS CHAR),
  unit_id = (SELECT id FROM `unit` WHERE name = 'millilitre')
WHERE ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'salad dressing')
  AND unit_id = (SELECT id FROM `unit` WHERE name = 'bottle');


COMMIT;

-- Verification - should return no rows:
--
--   SELECT i.name, p.quantity FROM part p
--   JOIN ingredient i ON i.id = p.ingredient_id JOIN unit u ON u.id = p.unit_id
--   WHERE u.name IN ('packet','bottle');
--
-- The `packet` and `bottle` Units themselves are deliberately left in the
-- catalog: Recipe Import can still produce them, and an unrecognised Unit is a
-- supported state (it simply won't combine until given a Unit Size).
