-- Consolidate Ingredients found by a manual audit of the catalog (2026-07-28),
-- after migrations 019-029 were applied to production.
--
-- Same shape as 011, 023 and 029: near-duplicate names split one Shopping List
-- item into two lines permanently, because Ingredients only combine on a name.
--
-- Fifteen merges and six empty rows. The six carry no Ingredient Lines at all,
-- so there is nothing to repoint - they are deleted outright at the foot of this
-- file rather than merged.
--
-- Pure DML. Pipe directly, NOT through anything using `mysql --force`.

START TRANSACTION;

-- 'can of salmon' -> 'salmon': its single line is `210 gram` in Salmon and asparagus frittata, which is one
-- standard tin. Repointed AND restated as `1 tin`, per the audit.
--
-- Deliberately NOT given a `tin` Unit Size, which would let it convert to grams.
-- `salmon` already has a count Unit Size of 130g (one fillet), so a tin that
-- converted would silently add itself to fresh fillets and the list would say
-- "710 gram salmon" for a shop that is really 500g of fillets plus a tin. Left
-- unconvertible, the list shows `500 gram + 1 tin`, which is what you buy
UPDATE `part` SET ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'salmon'),
    unit_id = (SELECT id FROM `unit` WHERE name = 'tin'),
    quantity = '1'
WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'can of salmon') x);
INSERT INTO `ingredient_department` (department_id, ingredient_id)
SELECT idp.department_id, (SELECT id FROM `ingredient` WHERE name = 'salmon')
FROM `ingredient_department` idp
WHERE idp.ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'can of salmon') x)
  AND NOT EXISTS (SELECT 1 FROM (SELECT ingredient_id FROM `ingredient_department`) y
                  WHERE y.ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'salmon'));
DELETE FROM `ingredient_department` WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'can of salmon') x);
DELETE FROM `ingredient_unit_size`  WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'can of salmon') x);
DELETE FROM `ingredient` WHERE name = 'can of salmon';

-- 'flat-leaf parsley' -> 'parsley': 1 line into 25; the winner carries the 0.27 density
UPDATE `part` SET ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'parsley')
WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'flat-leaf parsley') x);
INSERT INTO `ingredient_department` (department_id, ingredient_id)
SELECT idp.department_id, (SELECT id FROM `ingredient` WHERE name = 'parsley')
FROM `ingredient_department` idp
WHERE idp.ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'flat-leaf parsley') x)
  AND NOT EXISTS (SELECT 1 FROM (SELECT ingredient_id FROM `ingredient_department`) y
                  WHERE y.ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'parsley'));
DELETE FROM `ingredient_department` WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'flat-leaf parsley') x);
DELETE FROM `ingredient_unit_size`  WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'flat-leaf parsley') x);
DELETE FROM `ingredient` WHERE name = 'flat-leaf parsley';

-- 'floury potato' -> 'potato': 1 line into 24
UPDATE `part` SET ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'potato')
WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'floury potato') x);
INSERT INTO `ingredient_department` (department_id, ingredient_id)
SELECT idp.department_id, (SELECT id FROM `ingredient` WHERE name = 'potato')
FROM `ingredient_department` idp
WHERE idp.ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'floury potato') x)
  AND NOT EXISTS (SELECT 1 FROM (SELECT ingredient_id FROM `ingredient_department`) y
                  WHERE y.ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'potato'));
DELETE FROM `ingredient_department` WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'floury potato') x);
DELETE FROM `ingredient_unit_size`  WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'floury potato') x);
DELETE FROM `ingredient` WHERE name = 'floury potato';

-- 'fresh ginger' -> 'ginger': 1 line into 26; the winner carries the 0.6 density
UPDATE `part` SET ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'ginger')
WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'fresh ginger') x);
INSERT INTO `ingredient_department` (department_id, ingredient_id)
SELECT idp.department_id, (SELECT id FROM `ingredient` WHERE name = 'ginger')
FROM `ingredient_department` idp
WHERE idp.ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'fresh ginger') x)
  AND NOT EXISTS (SELECT 1 FROM (SELECT ingredient_id FROM `ingredient_department`) y
                  WHERE y.ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'ginger'));
DELETE FROM `ingredient_department` WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'fresh ginger') x);
DELETE FROM `ingredient_unit_size`  WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'fresh ginger') x);
DELETE FROM `ingredient` WHERE name = 'fresh ginger';

-- 'freshly squeezed lemon juice' -> 'lemon juice': 1 line into 3; the winner is already based in millilitres
UPDATE `part` SET ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'lemon juice')
WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'freshly squeezed lemon juice') x);
INSERT INTO `ingredient_department` (department_id, ingredient_id)
SELECT idp.department_id, (SELECT id FROM `ingredient` WHERE name = 'lemon juice')
FROM `ingredient_department` idp
WHERE idp.ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'freshly squeezed lemon juice') x)
  AND NOT EXISTS (SELECT 1 FROM (SELECT ingredient_id FROM `ingredient_department`) y
                  WHERE y.ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'lemon juice'));
DELETE FROM `ingredient_department` WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'freshly squeezed lemon juice') x);
DELETE FROM `ingredient_unit_size`  WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'freshly squeezed lemon juice') x);
DELETE FROM `ingredient` WHERE name = 'freshly squeezed lemon juice';

-- 'fresh red chilli pepper' -> 'red chilli': 1 line into 13
UPDATE `part` SET ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'red chilli')
WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'fresh red chilli pepper') x);
INSERT INTO `ingredient_department` (department_id, ingredient_id)
SELECT idp.department_id, (SELECT id FROM `ingredient` WHERE name = 'red chilli')
FROM `ingredient_department` idp
WHERE idp.ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'fresh red chilli pepper') x)
  AND NOT EXISTS (SELECT 1 FROM (SELECT ingredient_id FROM `ingredient_department`) y
                  WHERE y.ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'red chilli'));
DELETE FROM `ingredient_department` WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'fresh red chilli pepper') x);
DELETE FROM `ingredient_unit_size`  WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'fresh red chilli pepper') x);
DELETE FROM `ingredient` WHERE name = 'fresh red chilli pepper';

-- 'grated parmesan' -> 'parmesan': 3 lines into 5; both sides already carry the same 0.4 density, so nothing is lost
UPDATE `part` SET ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'parmesan')
WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'grated parmesan') x);
INSERT INTO `ingredient_department` (department_id, ingredient_id)
SELECT idp.department_id, (SELECT id FROM `ingredient` WHERE name = 'parmesan')
FROM `ingredient_department` idp
WHERE idp.ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'grated parmesan') x)
  AND NOT EXISTS (SELECT 1 FROM (SELECT ingredient_id FROM `ingredient_department`) y
                  WHERE y.ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'parmesan'));
DELETE FROM `ingredient_department` WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'grated parmesan') x);
DELETE FROM `ingredient_unit_size`  WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'grated parmesan') x);
DELETE FROM `ingredient` WHERE name = 'grated parmesan';

-- 'leftover cooked chicken' -> 'chicken': 1 line into 1
UPDATE `part` SET ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'chicken')
WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'leftover cooked chicken') x);
INSERT INTO `ingredient_department` (department_id, ingredient_id)
SELECT idp.department_id, (SELECT id FROM `ingredient` WHERE name = 'chicken')
FROM `ingredient_department` idp
WHERE idp.ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'leftover cooked chicken') x)
  AND NOT EXISTS (SELECT 1 FROM (SELECT ingredient_id FROM `ingredient_department`) y
                  WHERE y.ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'chicken'));
DELETE FROM `ingredient_department` WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'leftover cooked chicken') x);
DELETE FROM `ingredient_unit_size`  WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'leftover cooked chicken') x);
DELETE FROM `ingredient` WHERE name = 'leftover cooked chicken';

-- 'nice bread' -> 'bread': 1 line into a row that had none. `bread` already existed
-- with no Ingredient Lines at all, so this is the first thing to use it
UPDATE `part` SET ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'bread')
WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'nice bread') x);
INSERT INTO `ingredient_department` (department_id, ingredient_id)
SELECT idp.department_id, (SELECT id FROM `ingredient` WHERE name = 'bread')
FROM `ingredient_department` idp
WHERE idp.ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'nice bread') x)
  AND NOT EXISTS (SELECT 1 FROM (SELECT ingredient_id FROM `ingredient_department`) y
                  WHERE y.ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'bread'));
DELETE FROM `ingredient_department` WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'nice bread') x);
DELETE FROM `ingredient_unit_size`  WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'nice bread') x);
DELETE FROM `ingredient` WHERE name = 'nice bread';

-- Both `ripe tomato` spellings collapse into `tomato`, which has 9 lines to their
-- 2 each. `tomato` is the uncurated side, though, and both losers carry a count
-- Unit Size of 120g and a count Display Unit - the third case in this catalog
-- where a merge would throw away the curated values by deleting the wrong row.
-- Copied across first, with IFNULL so a value on the winner would still win.
--
-- The two losers are curated identically (120g either way), so which one this
-- reads from does not matter.
UPDATE `ingredient` SET
  display_unit_id = IFNULL(display_unit_id,
    (SELECT v FROM (SELECT display_unit_id AS v FROM `ingredient` WHERE name = 'ripe tomatoes') a))
WHERE name = 'tomato';
INSERT INTO `ingredient_unit_size` (ingredient_id, unit_id, size)
SELECT (SELECT id FROM `ingredient` WHERE name = 'tomato'), s.unit_id, s.size
FROM (SELECT ingredient_id, unit_id, size FROM `ingredient_unit_size`) s
WHERE s.ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'ripe tomatoes') x)
  AND NOT EXISTS (SELECT 1 FROM (SELECT ingredient_id, unit_id FROM `ingredient_unit_size`) y
                  WHERE y.ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'tomato')
                    AND y.unit_id = s.unit_id);

-- 'ripe medium tomato' -> 'tomato': 2 lines into 9. "ripe" is a quality note
-- rather than a different purchase, and extract.js's prompt already strips
-- preparation notes; keeping it split guaranteed the two would never combine
UPDATE `part` SET ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'tomato')
WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'ripe medium tomato') x);
INSERT INTO `ingredient_department` (department_id, ingredient_id)
SELECT idp.department_id, (SELECT id FROM `ingredient` WHERE name = 'tomato')
FROM `ingredient_department` idp
WHERE idp.ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'ripe medium tomato') x)
  AND NOT EXISTS (SELECT 1 FROM (SELECT ingredient_id FROM `ingredient_department`) y
                  WHERE y.ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'tomato'));
DELETE FROM `ingredient_department` WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'ripe medium tomato') x);
DELETE FROM `ingredient_unit_size`  WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'ripe medium tomato') x);
DELETE FROM `ingredient` WHERE name = 'ripe medium tomato';

-- 'ripe tomatoes' -> 'tomato': 2 lines into 9, same reasoning, and it drops the
-- plural that the singular naming rule in extract.js's prompt would fragment
-- against on every future import - the trap `spring onions` was already in
UPDATE `part` SET ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'tomato')
WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'ripe tomatoes') x);
INSERT INTO `ingredient_department` (department_id, ingredient_id)
SELECT idp.department_id, (SELECT id FROM `ingredient` WHERE name = 'tomato')
FROM `ingredient_department` idp
WHERE idp.ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'ripe tomatoes') x)
  AND NOT EXISTS (SELECT 1 FROM (SELECT ingredient_id FROM `ingredient_department`) y
                  WHERE y.ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'tomato'));
DELETE FROM `ingredient_department` WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'ripe tomatoes') x);
DELETE FROM `ingredient_unit_size`  WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'ripe tomatoes') x);
DELETE FROM `ingredient` WHERE name = 'ripe tomatoes';


-- 'unsalted butter or butter ghee' -> 'unsalted butter': 1 line into 1
UPDATE `part` SET ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'unsalted butter')
WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'unsalted butter or butter ghee') x);
INSERT INTO `ingredient_department` (department_id, ingredient_id)
SELECT idp.department_id, (SELECT id FROM `ingredient` WHERE name = 'unsalted butter')
FROM `ingredient_department` idp
WHERE idp.ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'unsalted butter or butter ghee') x)
  AND NOT EXISTS (SELECT 1 FROM (SELECT ingredient_id FROM `ingredient_department`) y
                  WHERE y.ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'unsalted butter'));
DELETE FROM `ingredient_department` WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'unsalted butter or butter ghee') x);
DELETE FROM `ingredient_unit_size`  WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'unsalted butter or butter ghee') x);
DELETE FROM `ingredient` WHERE name = 'unsalted butter or butter ghee';

-- 'mix powder' -> 'curry mix powder': 3 lines into 3, and the second case in this
-- catalog where the LOSER is the curated side. 026 gave `mix powder` a 0.5
-- density and 027 gave it a teaspoon Display Unit; `curry mix powder` has
-- neither. The DELETE below would drop both, so they are copied across first.
-- IFNULL, not a plain SET, so this cannot overwrite a curated value on the
-- winner if one is added before this runs.
UPDATE `ingredient` SET
  base_unit_id = IFNULL(base_unit_id,
    (SELECT v FROM (SELECT base_unit_id AS v FROM `ingredient` WHERE name = 'mix powder') a)),
  display_unit_id = IFNULL(display_unit_id,
    (SELECT v FROM (SELECT display_unit_id AS v FROM `ingredient` WHERE name = 'mix powder') b))
WHERE name = 'curry mix powder';
INSERT INTO `ingredient_unit_size` (ingredient_id, unit_id, size)
SELECT (SELECT id FROM `ingredient` WHERE name = 'curry mix powder'), s.unit_id, s.size
FROM (SELECT ingredient_id, unit_id, size FROM `ingredient_unit_size`) s
WHERE s.ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'mix powder') x)
  AND NOT EXISTS (SELECT 1 FROM (SELECT ingredient_id, unit_id FROM `ingredient_unit_size`) y
                  WHERE y.ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'curry mix powder')
                    AND y.unit_id = s.unit_id);

-- 'mix powder' -> 'curry mix powder': 3 lines into 3 - see the transfer above
UPDATE `part` SET ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'curry mix powder')
WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'mix powder') x);
INSERT INTO `ingredient_department` (department_id, ingredient_id)
SELECT idp.department_id, (SELECT id FROM `ingredient` WHERE name = 'curry mix powder')
FROM `ingredient_department` idp
WHERE idp.ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'mix powder') x)
  AND NOT EXISTS (SELECT 1 FROM (SELECT ingredient_id FROM `ingredient_department`) y
                  WHERE y.ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'curry mix powder'));
DELETE FROM `ingredient_department` WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'mix powder') x);
DELETE FROM `ingredient_unit_size`  WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'mix powder') x);
DELETE FROM `ingredient` WHERE name = 'mix powder';

-- 'garden pea' brings a `4 tablespoon` line to `peas`, which until now had only
-- gram lines and no density. Weight and volume amounts cannot convert without
-- one, so the Shopping List would show "300 gram + 4 tablespoon" as two amounts
-- on the line - exactly what 026's verification query looks for. 0.7 g/ml is
-- podded peas; this keeps that check returning nothing.
INSERT INTO `ingredient_unit_size` (ingredient_id, unit_id, size)
SELECT i.id, (SELECT id FROM `unit` WHERE name = 'millilitre'), 0.7
FROM `ingredient` i WHERE i.name = 'peas'
ON DUPLICATE KEY UPDATE size = VALUES(size);

-- 'garden pea' -> 'peas': 1 line into 9 - see the density above
UPDATE `part` SET ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'peas')
WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'garden pea') x);
INSERT INTO `ingredient_department` (department_id, ingredient_id)
SELECT idp.department_id, (SELECT id FROM `ingredient` WHERE name = 'peas')
FROM `ingredient_department` idp
WHERE idp.ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'garden pea') x)
  AND NOT EXISTS (SELECT 1 FROM (SELECT ingredient_id FROM `ingredient_department`) y
                  WHERE y.ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'peas'));
DELETE FROM `ingredient_department` WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'garden pea') x);
DELETE FROM `ingredient_unit_size`  WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'garden pea') x);
DELETE FROM `ingredient` WHERE name = 'garden pea';

-- 'flour' -> 'plain flour': 4 lines into 16. Both sides are curated with the
-- same 0.53 density, so nothing is lost. Unqualified "flour" means plain flour in
-- every recipe using it here; `self raising flour`, `gram flour`, `white bread
-- flour`, `oo flour` and `cornflour` stay separate, which is the distinction
-- extract.js's prompt actually asks to preserve
UPDATE `part` SET ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'plain flour')
WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'flour') x);
INSERT INTO `ingredient_department` (department_id, ingredient_id)
SELECT idp.department_id, (SELECT id FROM `ingredient` WHERE name = 'plain flour')
FROM `ingredient_department` idp
WHERE idp.ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'flour') x)
  AND NOT EXISTS (SELECT 1 FROM (SELECT ingredient_id FROM `ingredient_department`) y
                  WHERE y.ingredient_id = (SELECT id FROM `ingredient` WHERE name = 'plain flour'));
DELETE FROM `ingredient_department` WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'flour') x);
DELETE FROM `ingredient_unit_size`  WHERE ingredient_id = (SELECT id FROM (SELECT id FROM `ingredient` WHERE name = 'flour') x);
DELETE FROM `ingredient` WHERE name = 'flour';

-- Empty rows: no Ingredient Lines at all, so nothing to repoint. Verified
-- individually rather than assumed - 029 shipped with `thyme sprig` in a list
-- like this one, and it had a line.
--
-- `flor` was queried in the audit as a possible typo for `flour`. It has no
-- lines either way, so it needs no answer: nothing points at it.
DELETE FROM `ingredient_department` WHERE ingredient_id IN (SELECT id FROM (SELECT id FROM `ingredient` WHERE name IN
  ('flat-leaf parsley leaves', 'flor', 'hot chicken stock', 'lemon dressing or juice', 'panceta', 'skinless chicken breasts')) x);
DELETE FROM `ingredient_unit_size`  WHERE ingredient_id IN (SELECT id FROM (SELECT id FROM `ingredient` WHERE name IN
  ('flat-leaf parsley leaves', 'flor', 'hot chicken stock', 'lemon dressing or juice', 'panceta', 'skinless chicken breasts')) x);
DELETE FROM `ingredient` WHERE name IN
  ('flat-leaf parsley leaves', 'flor', 'hot chicken stock', 'lemon dressing or juice', 'panceta', 'skinless chicken breasts');

-- Recompute the curated marker: a merge can move curated values onto a winner
-- that was not previously flagged.
UPDATE `ingredient` SET `curated` = TRUE
WHERE base_unit_id IS NOT NULL
   OR display_unit_id IS NOT NULL
   OR EXISTS (SELECT 1 FROM `ingredient_unit_size` s WHERE s.ingredient_id = ingredient.id);

COMMIT;

-- Verification - the merged-away names should all be gone, and nothing orphaned:
--
--   SELECT name FROM ingredient WHERE name IN
--     ('can of salmon', 'flat-leaf parsley', 'flat-leaf parsley leaves', 'flor',
--      'floury potato', 'fresh ginger', 'freshly squeezed lemon juice',
--      'fresh red chilli pepper', 'garden pea', 'grated parmesan',
--      'hot chicken stock', 'leftover cooked chicken', 'lemon dressing or juice',
--      'mix powder', 'nice bread', 'panceta', 'ripe medium tomato',
--      'ripe tomatoes', 'flour', 'skinless chicken breasts',
--      'unsalted butter or butter ghee');
--
--   SELECT COUNT(*) FROM part p LEFT JOIN ingredient i ON i.id = p.ingredient_id
--   WHERE i.id IS NULL;
--
--   -- and the salmon line should now read `1 tin`:
--   SELECT p.quantity, u.name FROM part p JOIN unit u ON u.id = p.unit_id
--   JOIN ingredient i ON i.id = p.ingredient_id WHERE i.name = 'salmon' AND u.name = 'tin';
