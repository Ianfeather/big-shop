-- Local dev fixtures, applied once after migrations on a fresh database.
-- `local-dev-user` matches the default DEV_USER_ID in app.go's devUserMiddleware
-- and the mock user in hooks/use-auth.js, so the DISABLE_AUTH flow resolves to
-- a real account end-to-end. It's added to account id 1, the account that
-- migrations/008_user.sql already creates on a fresh DB.

INSERT INTO `user` (id, name, email) VALUES ('local-dev-user', 'Local Dev', 'dev@localhost');
INSERT INTO `account_user` (user_id, account_id) VALUES ('local-dev-user', 1);

INSERT INTO `unit` (name) VALUES
  ('gram'), ('kilogram'), ('millilitre'), ('litre'),
  ('teaspoon'), ('tablespoon'), ('packet'), ('whole'), ('clove'), ('pinch');

INSERT INTO `ingredient` (name) VALUES
  ('Spaghetti'), ('Beef Mince'), ('Onion'), ('Garlic Clove'),
  ('Chopped Tomatoes'), ('Olive Oil'), ('Salt'), ('Black Pepper'),
  ('Carrot'), ('Celery');

INSERT INTO `ingredient_department` (department_id, ingredient_id)
SELECT d.id, i.id FROM `department` d, `ingredient` i
WHERE d.name = 'vegetables' AND i.name IN ('Onion', 'Garlic Clove', 'Carrot', 'Celery');

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
