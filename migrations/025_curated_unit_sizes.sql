-- Curated Base Units, Display Units and Unit Sizes.
-- Drafted in specs/curation/phase-2-values.md and reviewed line by line.
--
-- A Unit Size answers "how much is one <unit> of <ingredient>", in that
-- ingredient's own Base Unit - which is why one "tin = 400" is right for both
-- 400g of chopped tomatoes and 400ml of coconut milk. See docs/adr/0004.
--
-- MUST run after 022, 023 and 024. Those correct the underlying data, and
-- doing so removes seven ingredients from this file entirely (lemon, white
-- wine, worcestershire sauce, pumpkin, orange juice, chicken stock, garlic) -
-- once their bad line is fixed they stop colliding and need nothing.
--
-- Everything here is additive and reversible: deleting the ingredient_unit_size
-- rows and nulling the two ingredient columns returns the Shopping List to
-- exactly its current behaviour.
--
-- Pure DML, so the transaction is real. Pipe this file directly, NOT through
-- anything using `mysql --force`.

START TRANSACTION;

-- ---- 1. Unit-level defaults -------------------------------------------
-- Only for Units whose size genuinely doesn't vary by ingredient. packet,
-- bottle, slice and the bare count deliberately get none: their size depends
-- entirely on what's being measured, so they stay per-ingredient.

UPDATE `unit` SET default_size = 0.5 WHERE name = 'pinch';  -- a pinch is a pinch, whatever it's of
UPDATE `unit` SET default_size = 5 WHERE name = 'clove';  -- a garlic clove; garlic is its only user
UPDATE `unit` SET default_size = 400 WHERE name = 'tin';  -- stated tin weight, not drained - how you buy them

-- ---- 2. Base Units ----------------------------------------------------
-- Everything not listed stays gram, which IngredientCatalog.Get supplies as
-- the default - no row needed just to say "nothing set".
UPDATE `ingredient` SET base_unit_id = (SELECT id FROM `unit` WHERE name = 'millilitre')
WHERE name IN ('almond milk', 'chicken stock', 'cider', 'coconut cream', 'coconut milk', 'double cream', 'olive oil', 'orange juice', 'salad dressing', 'sesame oil', 'soy sauce', 'vegetable oil', 'white wine', 'worcestershire sauce');

-- ---- 3. Display Units -------------------------------------------------
-- What a combined total is *shown* in. The base amount stays visible in
-- brackets, so an approximate Unit Size can be judged rather than trusted.
UPDATE `ingredient` SET display_unit_id = (SELECT id FROM `unit` WHERE name = '')
WHERE name IN ('apples', 'avocado', 'bacon rashers (smoked)', 'cabbage', 'carrot', 'chicken breast', 'chicken thigh', 'chicken thighs (boneless)', 'egg whites', 'mozzarella', 'new potato', 'onion', 'plum tomato', 'potato', 'radish', 'red onion', 'ripe medium tomato', 'ripe tomatoes', 'salmon', 'shallot', 'sweet potato');

UPDATE `ingredient` SET display_unit_id = (SELECT id FROM `unit` WHERE name = 'tin')
WHERE name IN ('arrocina beans', 'butter beans', 'butterbean', 'chopped tomatoes', 'coconut cream', 'coconut milk', 'gigantes beans', 'haricot beans', 'kidney beans');

-- ---- 4. Average weight of one ------------------------------------------
-- A Unit Size against the bare-count Unit: "one onion is 150g".
INSERT INTO `ingredient_unit_size` (ingredient_id, unit_id, size)
SELECT i.id, (SELECT id FROM `unit` WHERE name = ''), v.size
FROM `ingredient` i JOIN (
SELECT 'apples' AS name, 150 AS size
  UNION ALL SELECT 'asparagus' AS name, 20 AS size
  UNION ALL SELECT 'avocado' AS name, 200 AS size
  UNION ALL SELECT 'bacon rashers (smoked)' AS name, 25 AS size
  UNION ALL SELECT 'cabbage' AS name, 900 AS size
  UNION ALL SELECT 'carrot' AS name, 80 AS size
  UNION ALL SELECT 'cherry tomato' AS name, 15 AS size
  UNION ALL SELECT 'chicken breast' AS name, 180 AS size
  UNION ALL SELECT 'chicken thigh' AS name, 120 AS size
  UNION ALL SELECT 'chicken thighs (boneless)' AS name, 120 AS size
  UNION ALL SELECT 'chorizo' AS name, 225 AS size
  UNION ALL SELECT 'curry leaves' AS name, 0.3 AS size
  UNION ALL SELECT 'egg whites' AS name, 33 AS size
  UNION ALL SELECT 'ginger' AS name, 30 AS size
  UNION ALL SELECT 'lasagne sheets' AS name, 15 AS size
  UNION ALL SELECT 'mint' AS name, 5 AS size
  UNION ALL SELECT 'mozzarella' AS name, 125 AS size
  UNION ALL SELECT 'new potato' AS name, 50 AS size
  UNION ALL SELECT 'onion' AS name, 150 AS size
  UNION ALL SELECT 'plum tomato' AS name, 70 AS size
  UNION ALL SELECT 'potato' AS name, 180 AS size
  UNION ALL SELECT 'radish' AS name, 15 AS size
  UNION ALL SELECT 'red onion' AS name, 150 AS size
  UNION ALL SELECT 'ripe medium tomato' AS name, 120 AS size
  UNION ALL SELECT 'ripe tomatoes' AS name, 120 AS size
  UNION ALL SELECT 'rosemary' AS name, 5 AS size
  UNION ALL SELECT 'salmon' AS name, 130 AS size
  UNION ALL SELECT 'shallot' AS name, 40 AS size
  UNION ALL SELECT 'sweet potato' AS name, 200 AS size
  UNION ALL SELECT 'tenderstem broccoli' AS name, 15 AS size
  UNION ALL SELECT 'thyme' AS name, 3 AS size
  UNION ALL SELECT 'walnut halves' AS name, 2 AS size
) v ON v.name = i.name
ON DUPLICATE KEY UPDATE size = VALUES(size);

-- ---- 5. Densities ------------------------------------------------------
-- Grams per millilitre, stored as a Unit Size against `millilitre`. Every
-- other volume Unit derives from it, so teaspoon and tablespoon are covered by
-- this one value and can't be set inconsistently.
INSERT INTO `ingredient_unit_size` (ingredient_id, unit_id, size)
SELECT i.id, (SELECT id FROM `unit` WHERE name = 'millilitre'), v.size
FROM `ingredient` i JOIN (
SELECT 'basil' AS name, 0.2 AS size
  UNION ALL SELECT 'black pepper' AS name, 0.5 AS size
  UNION ALL SELECT 'breadcrumbs' AS name, 0.4 AS size
  UNION ALL SELECT 'brown sugar' AS name, 0.8 AS size
  UNION ALL SELECT 'butter' AS name, 0.95 AS size
  UNION ALL SELECT 'caster sugar' AS name, 0.85 AS size
  UNION ALL SELECT 'chilli flakes' AS name, 0.4 AS size
  UNION ALL SELECT 'chilli powder' AS name, 0.5 AS size
  UNION ALL SELECT 'chives' AS name, 0.2 AS size
  UNION ALL SELECT 'coriander' AS name, 0.2 AS size
  UNION ALL SELECT 'coriander seeds' AS name, 0.45 AS size
  UNION ALL SELECT 'cornflour' AS name, 0.6 AS size
  UNION ALL SELECT 'cumin seeds' AS name, 0.5 AS size
  UNION ALL SELECT 'dill' AS name, 0.27 AS size
  UNION ALL SELECT 'double cream' AS name, 1.0 AS size
  UNION ALL SELECT 'fennel seeds' AS name, 0.45 AS size
  UNION ALL SELECT 'flour' AS name, 0.53 AS size
  UNION ALL SELECT 'ginger & garlic paste' AS name, 1.1 AS size
  UNION ALL SELECT 'gram flour' AS name, 0.55 AS size
  UNION ALL SELECT 'grated parmesan' AS name, 0.4 AS size
  UNION ALL SELECT 'ground cinnamon' AS name, 0.5 AS size
  UNION ALL SELECT 'honey' AS name, 1.4 AS size
  UNION ALL SELECT 'margarine' AS name, 0.95 AS size
  UNION ALL SELECT 'mint' AS name, 0.27 AS size
  UNION ALL SELECT 'nutmeg' AS name, 0.5 AS size
  UNION ALL SELECT 'parmesan' AS name, 0.4 AS size
  UNION ALL SELECT 'parsley' AS name, 0.27 AS size
  UNION ALL SELECT 'plain flour' AS name, 0.53 AS size
  UNION ALL SELECT 'pomegranate seeds' AS name, 0.6 AS size
  UNION ALL SELECT 'rosemary' AS name, 0.2 AS size
  UNION ALL SELECT 'saffron' AS name, 0.2 AS size
  UNION ALL SELECT 'salt' AS name, 1.2 AS size
  UNION ALL SELECT 'sugar' AS name, 0.85 AS size
  UNION ALL SELECT 'thyme' AS name, 0.2 AS size
  UNION ALL SELECT 'tomato puree' AS name, 1.1 AS size
  UNION ALL SELECT 'yoghurt' AS name, 1.03 AS size
) v ON v.name = i.name
ON DUPLICATE KEY UPDATE size = VALUES(size);

COMMIT;

-- Verification:
--
--   -- three rows: clove 5, pinch 0.5, tin 400
--   SELECT name, default_size FROM unit WHERE default_size IS NOT NULL;
--
--   -- every curated value, readably
--   SELECT i.name, IFNULL(NULLIF(u.name,''),'(count)') AS unit, s.size,
--          IFNULL(NULLIF(b.name,''),'gram') AS base,
--          IFNULL(NULLIF(d.name,''),'(count)') AS display
--   FROM ingredient_unit_size s
--   JOIN ingredient i ON i.id = s.ingredient_id
--   JOIN unit u ON u.id = s.unit_id
--   LEFT JOIN unit b ON b.id = i.base_unit_id
--   LEFT JOIN unit d ON d.id = i.display_unit_id
--   ORDER BY i.name, u.name;
--
--   -- any name that failed to match an ingredient simply inserted nothing;
--   -- this counts what did land (expect 32 counts + 36 densities = 68)
--   SELECT COUNT(*) FROM ingredient_unit_size;
--
-- To undo entirely:
--   DELETE FROM ingredient_unit_size;
--   UPDATE ingredient SET base_unit_id = NULL, display_unit_id = NULL;
--   UPDATE unit SET default_size = NULL;
