-- Fix Recipe `method` text where a stray "N." mid-step makes the Method
-- render as one flat paragraph instead of a numbered list.
--
-- `parseMethodSteps` (components/recipe/index.tsx) splits Method into steps
-- client-side with a heuristic: matchAll on `(?:^|\s)(\d+)\.\s+`, then check
-- the captured numbers run 1, 2, 3... An oven-temperature aside written as
-- "gas 6." or "gas mark 5." mid-sentence looks exactly like a step marker to
-- that regex. Worse, matching it consumes the whitespace immediately before
-- it - so if that false marker sits right before the *next real* one, the
-- real marker loses the leading whitespace the regex requires and is skipped
-- too. One stray "N." derails the sequence check, and the whole Method falls
-- back to `<p>{method}</p>`: no step breaks at all. Recipe 33 (Apple Crumble)
-- is the example that surfaced this - "fan/gas 5. Toss the apples..." breaks
-- the numbering for every step after it.
--
-- Confirmed against a full prod dump (prod-sync-1-20260920-183728.sql) by
-- simulating the exact client regex against every Recipe's `method`: 6 rows
-- were affected. Five are fixed here, each by adjusting only the offending
-- punctuation - nothing about what a step says changes:
--
--   * id 15, 66: the false "N." sits right at a step boundary (immediately
--     followed by "\nM."), so the fix drops the redundant period - the
--     newline already ends the sentence.
--   * id 33, 55, 56: the false "N." is mid-sentence ("gas 5. Toss..."), so
--     the fix joins the two clauses with a comma instead ("gas 5, toss...").
--
-- Recipe 750117 (Base Curry Sauce) is deliberately left out. Its `method` has
-- a second, independently-numbered "Optional pressure-cooker method" list
-- (steps 1-4 after the main steps 1-13), so the sequence check fails at the
-- 13-to-1 restart regardless of any punctuation fix - making it present as a
-- single list would mean renumbering or restructuring that second list,
-- which is a content decision, not a whitespace correction. Flagged
-- separately rather than guessed at here.
--
-- Each UPDATE is self-guarding: REPLACE() is a no-op if the exact fragment
-- isn't present, and the WHERE repeats that same fragment, so a row already
-- hand-corrected or otherwise drifted since this was written is left alone
-- rather than double-edited. Safe to apply more than once.
--
-- Pure DML. Each statement stands alone, so this is not wrapped in a
-- transaction - same reasoning as migration 031.

UPDATE `recipe`
SET method = REPLACE(method,
  'Preheat the oven to 200C, 180C fan, or gas 6.\n2.',
  'Preheat the oven to 200C, 180C fan, or gas 6\n2.')
WHERE id = 15
  AND method LIKE '%Preheat the oven to 200C, 180C fan, or gas 6.\n2.%';

UPDATE `recipe`
SET method = REPLACE(method,
  'Heat the oven to 190C/170C fan/gas 5. Toss the apples',
  'Heat the oven to 190C/170C fan/gas 5, toss the apples')
WHERE id = 33
  AND method LIKE '%Heat the oven to 190C/170C fan/gas 5. Toss the apples%';

UPDATE `recipe`
SET method = REPLACE(method,
  'Preheat the oven to 190°C, gas mark 5. Cover the beetroot',
  'Preheat the oven to 190°C, gas mark 5, cover the beetroot')
WHERE id = 55
  AND method LIKE '%Preheat the oven to 190°C, gas mark 5. Cover the beetroot%';

UPDATE `recipe`
SET method = REPLACE(method,
  'Heat the oven to 200C, 180C fan, or gas 6. Line the pastry case',
  'Heat the oven to 200C, 180C fan, or gas 6, line the pastry case')
WHERE id = 56
  AND method LIKE '%Heat the oven to 200C, 180C fan, or gas 6. Line the pastry case%';

UPDATE `recipe`
SET method = REPLACE(method,
  'Preheat the oven to 160C, 140C fan, or gas mark 3.\n5.',
  'Preheat the oven to 160C, 140C fan, or gas mark 3\n5.')
WHERE id = 66
  AND method LIKE '%Preheat the oven to 160C, 140C fan, or gas mark 3.\n5.%';

-- Verification - should return no rows:
--   SELECT id, name FROM `recipe` WHERE id IN (15, 33, 55, 56, 66) AND (
--        method LIKE '%gas 6.\n2.%'
--     OR method LIKE '%fan/gas 5. Toss the apples%'
--     OR method LIKE '%gas mark 5. Cover the beetroot%'
--     OR method LIKE '%gas 6. Line the pastry case%'
--     OR method LIKE '%gas mark 3.\n5.%'
--   );
