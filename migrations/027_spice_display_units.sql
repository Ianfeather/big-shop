-- Show spices in teaspoons. Resolves follow-ups.md #28.
--
-- The original problem statement asked for "a preferred unit for each
-- ingredient... teaspoon for spices but not for herbs". The mechanism shipped in
-- Phase 3, but every Display Unit curated in 025 was a bare count or a tin, so
-- nothing actually read in spoons.
--
-- Herbs are deliberately excluded, per that same sentence: coriander, parsley,
-- dill, mint, basil, thyme, sage and chives keep their weights. So do whole or
-- fresh items that are counted rather than spooned - green and red chillies,
-- cardamom pods, cinnamon sticks, peppers.
--
-- A Display Unit only works if the total can be converted into it, which for a
-- volume unit means the ingredient needs a density. Six spices had none, so
-- they are added here first.
--
-- Note teaspoon is an Absolute Unit, so totals keep their natural precision
-- rather than rounding up to a whole - "2.2 teaspoon", not "3 teaspoon". Round-up
-- applies to Relative Display Units, where a fraction isn't purchasable; a
-- fraction of a teaspoon is a perfectly normal thing for a recipe to want.
--
-- Pure DML. Pipe directly, NOT through anything using `mysql --force`.

START TRANSACTION;

-- Densities for the spices that had none, so the Display Unit below can resolve.
INSERT INTO `ingredient_unit_size` (ingredient_id, unit_id, size)
SELECT i.id, (SELECT id FROM `unit` WHERE name = 'millilitre'), v.size
FROM `ingredient` i JOIN (
            SELECT 'garam masala'           AS name, 0.5 AS size
  UNION ALL SELECT 'turmeric',                0.55
  UNION ALL SELECT 'cayenne powder',          0.5
  UNION ALL SELECT 'kashmiri chilli powder',  0.5
  UNION ALL SELECT 'mustard seeds',           0.6
  UNION ALL SELECT 'black mustard seed',      0.6
) v ON v.name = i.name
ON DUPLICATE KEY UPDATE size = VALUES(size);

-- Ground, powdered and seed spices read in teaspoons, with the weight kept in
-- brackets so the estimate stays visible.
UPDATE `ingredient` SET display_unit_id = (SELECT id FROM `unit` WHERE name = 'teaspoon')
WHERE display_unit_id IS NULL
  AND name IN (
    'paprika', 'smoked paprika', 'kashmiri chilli powder', 'cayenne powder',
    'chilli powder', 'chilli flakes',
    'ground cumin', 'cumin seeds', 'ground coriander', 'coriander seeds',
    'ground cinnamon', 'nutmeg', 'fennel seeds', 'turmeric', 'garam masala',
    'garlic powder', 'onion powder', 'mix powder',
    'mustard seeds', 'black mustard seed',
    'black pepper', 'saffron'
  );

COMMIT;

-- Verification - every row should show a teaspoon display and a density:
--
--   SELECT i.name, d.name AS display, s.size AS density
--   FROM ingredient i
--   JOIN unit d ON d.id = i.display_unit_id
--   LEFT JOIN ingredient_unit_size s ON s.ingredient_id = i.id
--        AND s.unit_id = (SELECT id FROM unit WHERE name = 'millilitre')
--   WHERE d.name = 'teaspoon' ORDER BY i.name;
--
-- A spice with a teaspoon display but no density would silently keep showing
-- grams - the conversion has nothing to work with. That query makes it obvious.
