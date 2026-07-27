-- Local dev fixtures, applied once after migrations on a fresh database.
-- `local-dev-user` matches the default DEV_USER_ID in app.go's devUserMiddleware
-- and the mock user in hooks/use-auth.js, so the DISABLE_AUTH flow resolves to
-- a real account end-to-end. It's added to account id 1, the account that
-- migrations/008_user.sql already creates on a fresh DB.

INSERT INTO `user` (id, name, email) VALUES ('local-dev-user', 'Local Dev', 'dev@localhost');
INSERT INTO `account_user` (user_id, account_id) VALUES ('local-dev-user', 1);

-- The blank-name row is a deliberate sentinel for "no unit, just a count" (e.g. "2 eggs") -
-- part.unit_id is NOT NULL, so count-only ingredients still need a real unit row to point to.
--
-- kind/factor are set here at insert time rather than left to
-- migrations/019_unit_kind.sql's UPDATE-by-name. On a fresh database every
-- migration runs before this file, so that UPDATE has no rows to match and would
-- silently leave every unit 'relative' - which only shows up when a dev volume is
-- wiped and rebuilt, not on a normal run. Keep these values in step with 019.
-- default_size follows the same rule for the same reason: migrations 020-025
-- set these against production's rows, which don't exist yet when they run
-- here. Keep in step with 025.
INSERT INTO `unit` (name, kind, factor, default_size) VALUES
  ('',           'relative', NULL, NULL),
  ('gram',       'weight',      1, NULL),
  ('kilogram',   'weight',   1000, NULL),
  ('millilitre', 'volume',      1, NULL),
  ('litre',      'volume',   1000, NULL),
  ('teaspoon',   'volume',      5, NULL),
  ('tablespoon', 'volume',     15, NULL),
  ('packet',     'relative', NULL, NULL),
  ('whole',      'relative', NULL, NULL),
  ('clove',      'relative', NULL,    5),
  ('pinch',      'relative', NULL,  0.5),
  ('tin',        'relative', NULL,  400);

INSERT INTO `ingredient` (name) VALUES
  ('Spaghetti'), ('Beef Mince'), ('Onion'), ('Garlic Clove'),
  ('Chopped Tomatoes'), ('Olive Oil'), ('Salt'), ('Black Pepper'),
  ('Carrot'), ('Celery');

INSERT INTO `ingredient_department` (department_id, ingredient_id)
SELECT d.id, i.id FROM `department` d, `ingredient` i
WHERE d.name = 'vegetables' AND i.name IN ('Onion', 'Garlic Clove', 'Carrot', 'Celery');

-- Curated Base Units, Display Units and Unit Sizes, mirroring what
-- migrations/025_curated_unit_sizes.sql applies to production. Set here at
-- insert time for the same reason as unit.kind above: 025 runs before any of
-- these rows exist, so on a fresh database it matches nothing.
--
-- Without this the entire Phase 2/3 feature is unreachable locally and in e2e -
-- no Unit Size means nothing ever converts, and the tests would pass just as
-- happily with the feature deleted. A small but genuinely representative set:
-- one count-to-weight ingredient, one pack size, one density, one liquid.
UPDATE `ingredient` SET base_unit_id = (SELECT id FROM `unit` WHERE name = 'millilitre')
WHERE name = 'Olive Oil';

UPDATE `ingredient` SET display_unit_id = (SELECT id FROM `unit` WHERE name = '')
WHERE name IN ('Onion', 'Carrot');
UPDATE `ingredient` SET display_unit_id = (SELECT id FROM `unit` WHERE name = 'tin')
WHERE name = 'Chopped Tomatoes';

INSERT INTO `ingredient_unit_size` (ingredient_id, unit_id, size)
SELECT i.id, u.id, v.size FROM `ingredient` i, `unit` u, (
  SELECT 'Onion' AS ing, '' AS un, 150 AS size
  UNION ALL SELECT 'Carrot', '', 80
  UNION ALL SELECT 'Garlic Clove', '', 5
  UNION ALL SELECT 'Chopped Tomatoes', 'tin', 400
  UNION ALL SELECT 'Black Pepper', 'millilitre', 0.5
) v
WHERE i.name = v.ing AND u.name = v.un;

INSERT INTO `ingredient_department` (department_id, ingredient_id)
SELECT d.id, i.id FROM `department` d, `ingredient` i
WHERE d.name = 'meat and fish' AND i.name = 'Beef Mince';

INSERT INTO `ingredient_department` (department_id, ingredient_id)
SELECT d.id, i.id FROM `department` d, `ingredient` i
WHERE d.name = 'other' AND i.name IN ('Spaghetti', 'Chopped Tomatoes', 'Olive Oil', 'Salt', 'Black Pepper');

INSERT INTO `recipe` (name, slug, account_id, method) VALUES
  ('Spaghetti Bolognese', 'spaghetti-bolognese', 1,
   'Brown the mince, soften the onion and garlic, add tomatoes and simmer for 30 minutes. Serve over cooked spaghetti.');
SET @bolognese_id = LAST_INSERT_ID();

INSERT INTO `part` (recipe_id, ingredient_id, unit_id, quantity)
SELECT @bolognese_id, i.id, u.id, x.quantity FROM (
  SELECT 'Spaghetti' AS ingredient_name, 'gram' AS unit_name, '400' AS quantity
  UNION ALL SELECT 'Beef Mince', 'gram', '500'
  UNION ALL SELECT 'Onion', 'whole', '1'
  UNION ALL SELECT 'Garlic Clove', 'clove', '2'
  UNION ALL SELECT 'Chopped Tomatoes', 'gram', '800'
  UNION ALL SELECT 'Olive Oil', 'tablespoon', '1'
) x
JOIN `ingredient` i ON i.name = x.ingredient_name
JOIN `unit` u ON u.name = x.unit_name;

INSERT INTO `recipe_tag` (recipe_id, tag_name) VALUES (@bolognese_id, 'Batch Cook');

INSERT INTO `recipe` (name, slug, account_id, method) VALUES
  ('Veggie Chilli', 'veggie-chilli', 1,
   'Soften the onion, celery and garlic, add tomatoes and simmer for 20 minutes with your favourite beans.');
SET @chilli_id = LAST_INSERT_ID();

INSERT INTO `part` (recipe_id, ingredient_id, unit_id, quantity)
SELECT @chilli_id, i.id, u.id, x.quantity FROM (
  SELECT 'Onion' AS ingredient_name, 'whole' AS unit_name, '1' AS quantity
  UNION ALL SELECT 'Celery', 'whole', '2'
  UNION ALL SELECT 'Garlic Clove', 'clove', '2'
  UNION ALL SELECT 'Chopped Tomatoes', 'gram', '400'
  UNION ALL SELECT 'Olive Oil', 'tablespoon', '1'
) x
JOIN `ingredient` i ON i.name = x.ingredient_name
JOIN `unit` u ON u.name = x.unit_name;

INSERT INTO `recipe_tag` (recipe_id, tag_name) VALUES (@chilli_id, 'Vegetarian');
INSERT INTO `recipe_tag` (recipe_id, tag_name) VALUES (@chilli_id, 'Batch Cook');
