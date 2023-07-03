-- carrot/carrots
select * from ingredient where name like "%carrot%";
UPDATE `part` set ingredient_id = 5 WHERE ingredient_id = 71;
DELETE FROM ingredient_department WHERE ingredient_id = 71;
DELETE FROM ingredient WHERE id = 71;

-- coriander/coriander leaves
select * from ingredient where name like "%coriander%";
UPDATE `part` set ingredient_id = 97 WHERE ingredient_id = 922;
DELETE FROM ingredient WHERE id = 922;

-- garlic clove/garlic cloves
select * from ingredient where name like "%garlic%";
UPDATE `part` set ingredient_id = 47 WHERE ingredient_id = 919;
DELETE FROM ingredient WHERE id = 919;

-- medium onions/onion
select * from ingredient where name like "%onion%";
UPDATE `part` set ingredient_id = 4 WHERE ingredient_id = 815;
DELETE FROM ingredient WHERE id = 815;

-- "medium tomato"/tomato
select * from ingredient where name like "%tomato%";
UPDATE `part` set ingredient_id = 96 WHERE ingredient_id = 908;
DELETE FROM ingredient WHERE id = 908;

-- "minced pork"/pork mince
select * from ingredient where name like "%mince%";
UPDATE `part` set ingredient_id = 21 WHERE ingredient_id = 58;
DELETE FROM ingredient_department WHERE ingredient_id = 58;
DELETE FROM ingredient WHERE id = 58;

-- mince consistency
UPDATE `ingredient` set name = "Beef Mince" WHERE name = "minced beef";

-- Parsely / Parsley
select * from ingredient where name like "%pars%";
UPDATE `part` set ingredient_id = 52 WHERE ingredient_id = 330;
DELETE FROM ingredient_department WHERE ingredient_id = 330;
DELETE FROM ingredient WHERE id = 330;

-- "Red Onion"/"red onions"
select * from ingredient where name like "%red onion%";
UPDATE `part` set ingredient_id = 273 WHERE ingredient_id = 918;
DELETE FROM ingredient WHERE id = 918;
