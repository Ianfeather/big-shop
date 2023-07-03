UPDATE part SET
  unit_id = 1,
  ingredient_id = (SELECT id FROM ingredient WHERE name = 'Garlic Clove')
WHERE
  ingredient_id = (SELECT id FROM ingredient WHERE name = 'garlic');

DELETE FROM ingredient WHERE name = 'garlic';

UPDATE part SET
  unit_id = (SELECT id FROM unit WHERE name = 'tin'),
  ingredient_id = (SELECT id FROM ingredient WHERE name = 'Chopped Tomatoes')
WHERE
  ingredient_id = (SELECT id FROM ingredient WHERE name = 'Tinned Tomatoes')

DELETE FROM ingredient WHERE name = 'Tinned Tomatoes';
