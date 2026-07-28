-- Give dry ingredients a density so they combine into grams rather than
-- millilitres. Resolves follow-ups.md #26.
--
-- Migration 025 curated a density for every ingredient in the weight-volume
-- collision group - those had a gram line forcing the question. Ingredients used
-- *only* in volume units never surfaced, but they still combine into their
-- dimension's base unit, so a list with both "1 tbsp paprika" and "2 tsp
-- paprika" reads "25 millilitre paprika" rather than "13 gram".
--
-- Only bites when one list uses two different volume units for the same
-- ingredient - a single unit is preserved as-is - so this is a readability fix,
-- not a correctness one.
--
-- A density is stored as a Unit Size against `millilitre`; every other volume
-- Unit derives from it, so one value per ingredient covers teaspoon, tablespoon
-- and millilitre and cannot be set inconsistently.
--
-- Pure DML. Pipe directly, NOT through anything using `mysql --force`.

START TRANSACTION;

-- Dry goods: grams per millilitre.
INSERT INTO `ingredient_unit_size` (ingredient_id, unit_id, size)
SELECT i.id, (SELECT id FROM `unit` WHERE name = 'millilitre'), v.size
FROM `ingredient` i JOIN (
            SELECT 'ginger'           AS name, 0.6  AS size  -- grated
  UNION ALL SELECT 'paprika',           0.5
  UNION ALL SELECT 'smoked paprika',    0.5
  UNION ALL SELECT 'ground cumin',      0.5
  UNION ALL SELECT 'ground coriander',  0.5
  UNION ALL SELECT 'garlic powder',     0.55
  UNION ALL SELECT 'onion powder',      0.55
  UNION ALL SELECT 'mix powder',        0.5
  UNION ALL SELECT 'dried thyme',       0.2
  UNION ALL SELECT 'sage',              0.2
  UNION ALL SELECT 'pine nuts',         0.55
  UNION ALL SELECT 'sesame seeds',      0.6
  UNION ALL SELECT 'chia seeds',        0.6
  UNION ALL SELECT 'baking powder',     0.9
  UNION ALL SELECT 'peanut butter',     1.0
) v ON v.name = i.name
ON DUPLICATE KEY UPDATE size = VALUES(size);

-- Liquids: no density needed - millilitres are already the right answer, and
-- their volume units combine for free. Setting the Base Unit explicitly is
-- belt-and-braces for the day one of them gains a gram line.
UPDATE `ingredient` SET base_unit_id = (SELECT id FROM `unit` WHERE name = 'millilitre')
WHERE base_unit_id IS NULL
  AND name IN ('vegetable stock', 'passata', 'single cream', 'fish sauce',
               'shaoxing wine', 'tamari sauce', 'white vinegar', 'white wine vinegar',
               'lemon juice', 'ghee', 'milk', 'water', 'canola oil');

COMMIT;

-- Verification - should return no rows. An Ingredient with both weight lines
-- and volume lines but no density has nothing to convert between them, so its
-- amounts cannot combine and the list shows two of them side by side:
--
--   SELECT i.name, GROUP_CONCAT(DISTINCT u.name ORDER BY u.name) AS units_used
--   FROM part p JOIN unit u ON u.id = p.unit_id JOIN ingredient i ON i.id = p.ingredient_id
--   WHERE u.kind IN ('weight', 'volume')
--     AND i.id NOT IN (SELECT ingredient_id FROM ingredient_unit_size s
--                      JOIN unit u2 ON u2.id = s.unit_id WHERE u2.name = 'millilitre')
--   GROUP BY i.id, i.name
--   HAVING COUNT(DISTINCT u.kind) > 1;
--
-- An earlier version of this check asked a different question - volume lines on
-- an Ingredient with no Base Unit and no density - and claimed the same "no
-- rows". That was never true: 90 Ingredients are in that state, and the check
-- only appeared to pass because it also required two *distinct* volume units,
-- which almost nothing has. Running it after this migration duly returned one
-- row, `rice vinegar` with `litre,tablespoon`, which is not a defect at all:
-- litre and tablespoon are both kind='volume', so they combine through the
-- volume bucket on their factors alone (1 litre + 3 tablespoon -> 1.045 litre,
-- verified end to end). No density is involved and no Base Unit is needed.
--
-- The distinction the old check missed is that a missing Base Unit on a *liquid*
-- costs nothing - millilitres are already the right answer - while on a dry good
-- measured in spoons it costs the ability to combine with a gram line. Only the
-- second is a problem, and only once such a line exists, which is exactly what
-- the query above waits for. Setting Base Units on the liquids above stays
-- belt-and-braces rather than load-bearing.
