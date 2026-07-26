---
spec: specs/unit-normalisation.md
status: in-progress
branch: implement/unit-normalisation-phase-2
pr:
---

**Deployment order (applies to every phase of this spec):** each phase's migration must
reach production *before* the code that reads its columns. Phase 1's migration 019 is
applied and its code is merged, so that one is settled. Phase 2 adds columns that
`CombineIngredients` will read, so the same rule applies again - migration first, then
merge. The migration is additive and backward-compatible with the running code, so
applying it ahead of the merge has no outage window; merging first does, because Netlify
auto-deploys on push to master.

Apply production migrations by piping the file directly, **never** through anything using
`mysql --force`: it skips failing statements, so a failed ALTER would leave the following
UPDATEs silently matching nothing.

Branch point for Phase 1: `cb6eff6` (the spec/design commit).
Branch point for Phase 2: `8e594f0` (the Phase 1 merge).

**Phase 1 (Sessions 1-3) is merged** - PR #63, squashed onto master as `8e594f0`, and
migration 019 has been applied to production. Sessions 4-6 continue on a new branch,
`implement/unit-normalisation-phase-2`, branched from that merge. Overall status stays
`in-progress`: the spec is not complete, so it does NOT move to `specs/completed/` yet.

## Session 1: Unit kinds and factors
Status: done
Scope: migrations/019_unit_kind.sql adds `kind` + `factor` to `unit` and classifies the six Absolute Units by name; docker/mysql-seed/dev-seed.sql sets them at insert time (migrations run before seed data on a fresh DB, so the migration's UPDATE-by-name matches nothing there); service/units.go gains a UnitCatalog loader. No behaviour change.
Depends on: none
Commit: 570c03e
Notes: Test gate: go fmt/vet/test clean via the api container (no Go
toolchain on this host); no OpenAPI or api.d.ts drift. Both migration paths
exercised against real MySQL with identical results - the fresh-database
path in an isolated throwaway compose project (COMPOSE_PROJECT_NAME=
bigshop-migcheck, torn down with -v afterwards, so the local dev volume and
its non-seed recipe survived), the existing-database path applied to the
local dev DB. GetUnitCatalog run against the real schema via a throwaway
main to confirm DECIMAL and ENUM scan correctly and that the unknown-unit
fallback returns Relative; throwaway deleted. All of the above re-run after
the rename, and again after the review fixes changed the scan.

Review gate: the code-review skill's parallel sub-agents initially died on
transient API 529s (four attempts), so a self-review ran first; the real
two-axis review was then run successfully against the committed diff.
Findings acted on: UnitKind became a named type; IsAbsolute() now encodes
CONTEXT.md's Absolute/Relative split instead of leaving it as a prose
warning; UnitInfo dropped sql.NullFloat64 for a plain float64 with the
NULL-factor row normalised to Relative at load, keeping database/sql out of
the type the pure aggregator consumes; units_test.go added for Get's
fallback, IsAbsolute, and the tin-vs-pinch equal-Kinds trap;
specs/unit-normalisation.md's self-contradicting "key on ingredient_id, not
name - name-keying is half of the current bug" bullet corrected (the claim
was wrong: `ingredient` has UNIQUE(name), and the bug is that *unit* was
missing from the key); technical-architecture.md migration count 17 -> 19.

One finding rejected with evidence: "every column in 001-015 has a COMMENT,
so `kind` needs one". False - `name`/`slug`/`remote_url`/`created_at`/
`updated_at` in 001 have none, and every prior ALTER TABLE ADD COLUMN (009,
010, 014, 018) has none. The convention is to comment a column whose meaning
isn't self-evident; `kind` is explained at length in the migration header.

One judgement call raised and then acted on: the column was originally
`dimension ENUM('weight','volume','relative')` per the spec, which is a
category error - weight and volume are dimensions, 'relative' is the
absence of one. Renamed to `kind` after discussion with the user, and the
spec updated to match. Done before any merge, so no second migration was
needed. The related trap (every Relative Unit shares KindRelative, so a tin
and a pinch compare equal on Kind alone) was first documented as a comment
on UnitInfo and then, after the review, encoded properly as IsAbsolute() -
two Units combine when both IsAbsolute() and their Kinds match.

Also noted: one review sub-agent edited .claude/skills/implement/SKILL.md
before dying (removing the reference to the nonexistent `verify` skill).
Reverted - reviews must be read-only.

Deferred findings, raised by the review and deliberately NOT fixed here:

- **Seed/migration duplication has no drift guard.** Both files carry the six
  kind/factor values and cross-reference each other, but nothing enforces
  agreement. Raised by both axes. This will get worse in Session 4, which seeds
  ~76 curated Unit Sizes with the same fresh-vs-existing split. The suggested
  fix (re-apply 019's UPDATEs after the seed, making the migration the single
  source of truth) special-cases one migration in the init script, so it should
  be solved generally when Session 4 forces the issue - not bolted on now.
- **`mysql --force` can hide a first-application failure.** Re-runs are safe
  (duplicate-column ALTERs skipped, UPDATEs idempotent), but if the ALTERs ever
  fail on a *first* application the UPDATEs fail silently too and every unit
  stays 'relative' - wrong but plausible, with no error. **The manual production
  apply of 019 should therefore be piped directly without `--force`**, as was
  done against the local dev DB, so a failure actually surfaces.
- **`insertUnits` (service/recipe.go:391) inserts `(name)` only.** An imported
  abbreviation like "ml" or "tsp" would be created as a Relative Unit and never
  combine with its spelled-out twin. Mitigated in practice by the extraction
  prompt, which translates abbreviations and standardises to the known unit
  list, but it does mean the Absolute set is closed to six exact spellings.
  Worth revisiting if real data shows abbreviations getting through.

Two things carried forward: (1) `GetAllUnits` in the same file lacks
`defer results.Close()` and a `results.Err()` check and leaks a connection
on early return - pre-existing, left alone as out of scope, worth a
follow-up. (2) The implement skill's test gate calls for a `verify` skill
that does not exist in this environment; manual end-to-end verification was
substituted.

## Session 2: Unit-aware aggregation with multiple Amounts
Status: done
Scope: service/quantity.go (decimals, fractions, mixed numbers); common.Amount and ListIngredient.Amounts replacing the Unit/Quantity pair; CombineIngredients rewritten as a pure function taking the UnitCatalog, bucketing by unit kind and emitting one Amount per bucket; AddIngredientListItems writes one row per Amount and GetIngredientListItems groups them back by name; openapi.yaml + api.d.ts regenerated; Go table tests per collision category.
Depends on: Session 1
Commit: 86c9ca4
Notes: Keyed on ingredient name rather than ingredient_id - a deliberate
deviation from the spec's wording, agreed during planning. `ingredient.name`
is UNIQUE (migration 002) and every name here comes from that table, so it is
already a canonical identity; adding an `id` to `common.Ingredient` would
change a request payload for no observable gain.

**Scope adjustment:** the frontend changes needed to keep the tree compiling
(Item.tsx rendering Amounts, list.tsx, the ShoppingList fixtures) were folded
into this session rather than left to Session 3. Changing ListIngredient's
shape breaks the frontend by construction, so splitting them would have left
an intermediate commit where `npm run typecheck` fails. Session 3 is therefore
new *coverage* and the mock/eval surfaces, not the contract catch-up.

Test gate: Go 12 tests / 56 subtests; frontend 27 files / 98 tests; typecheck
and lint clean; no OpenAPI or api.d.ts drift. Verified end-to-end against a
live API + MySQL, not only in unit tests: 1 tbsp + 10 g garlic -> "10 gram +
15 millilitre" (the exact case that used to read "11 tablespoon"); 500 g + 1 kg
-> "1.5 kilogram"; 2 tin + 200 g -> two Amounts on one row, toggling bought
together from a single PATCH by name and surviving a regenerate; "1 1/2
tablespoon" -> "22.5 millilitre"; "a handful" kept verbatim instead of
vanishing. Test data cleaned out of the dev DB afterwards.

Found and recorded follow-up #24 while cleaning up: a Recipe that has ever been
added to a Shopping List cannot be deleted (DeleteRecipe misses
shopping_list_event, which has an FK to recipe). Pre-existing and user-facing;
masked in CI because e2e/api.ts's deleteRecipeById ignores the response status.
Not fixed here - out of Phase 1 scope, and it needs a deliberate decision about
whether deleting a Recipe should erase its Dave history.

## Session 3: Coverage for multiple Amounts, and the mock surfaces
Status: done
Scope: Vitest on Item.tsx for merged/unmerged/bare-count/verbatim amounts and the one-checkbox property; e2e/shopping-list.spec.ts extended with a mixed-unit scenario proving the merge through the real API; evals/mock-api-server.js updated to the Amounts shape and to stop summing unlike units.
Depends on: Session 2
Commit: 700b392
Notes: Reduced from the original plan - the Item.tsx/list.tsx/fixture changes
moved into Session 2 (see its scope adjustment), so this session is coverage
plus the mock surfaces.

Test gate: 13/13 e2e (10 existing + 3 new), frontend 28 files / 106 tests, Go
12 tests / 56 subtests, typecheck and lint clean, no drift.

**Fixed a trap worth remembering:** the new e2e tests failed for a reason that
had nothing to do with them. `test:e2e:stop` ran `docker compose down` without
`--volumes`, and MySQL only runs docker-entrypoint-initdb.d when its data
directory is empty - so a persisted volume pinned the e2e database to the
schema it had when first created (2026-07-25, before migration 019). Every
shopping-list request 500'd on the missing `kind` column and the list rendered
empty, which looks exactly like an application bug. This is the same
deployment-order hazard recorded at the top of this file, playing out locally,
and it would have recurred for every future migration. Now `--volumes`, so each
run starts freshly migrated and seeded; documented in CLAUDE.md. It also stops
fixture recipes accumulating across runs - the e2e database had dozens from
previous months, because teardown deletes fail silently (follow-ups.md #24).

Diagnosis note for future runs: the failing test was an *existing* one, which
initially looked like a Session 2 regression. Checking out the pre-Session-2
commit and re-running was what ruled that out. Worth doing before assuming a
green-to-red e2e test means the code under review broke it.

## Review gate: Sessions 2-3
Status: done
Commit: 38cb407
Notes: Two-axis code review ran successfully this time (the Session 1 attempt
had died on API 529s). Findings acted on:

- **The significant one:** a lone "1 teaspoon cumin" rendered as "5
  millilitre". Converting to the kind's base unit is only justified when Units
  actually differ; a single unit was never ambiguous. Since tsp<->tbsp is the
  most common collision in the real data this was a wide display regression on
  lines that were never broken, and only Phase 3 would have undone it. Fixed by
  having absoluteTotal remember whether one Unit contributed. Two existing test
  expectations had encoded the regression.
- ParseQuantity now accepts zero (rejecting it printed a verbatim "0 gram"
  beside the real total); negatives still surface verbatim.
- Dead `order` slice removed - it ordered insertion into a Go map.
- displayScale/scaleForDisplay renamed to absoluteScale/absoluteTotal.amount to
  stop colliding with CONTEXT.md's Display Unit, a different Phase 3 concept.
- Missing collision-category tests added (count<->weight, count<->volume,
  weight<->volume, zero, negative, single-unit preservation): 56 -> 64 subtests.
- CLAUDE.md paragraph splice, e2e comment that misdescribed its own serial
  behaviour, and a CSS-module selector in Item.test.tsx.

Judgement calls not acted on, with reasons:
- **Duplicated test factory** between Item.test.tsx and index.test.tsx (3
  lines). Extracting a shared helper for that would couple two test files for
  less code than the import costs; self-contained test fixtures are worth more.
- **NULL unit_id could make GetIngredientListItems' INNER JOIN drop one Amount
  of several.** Pre-existing, and not actually reachable: unit_id is NOT NULL,
  so a missing unit fails the INSERT loudly rather than being silently read
  back short. Left alone rather than restructuring the read path on a
  hypothetical.

## Session 4: Phase 2 schema (Unit Size)
Status: done
Scope: migrations/020_unit_size.sql - unit.default_size, ingredient.base_unit_id, and the ingredient_unit_size table. No values seeded.
Depends on: Session 3
Commit: 4fe0998
Notes: Applied to the local dev DB. Not yet applied to production - it must go
in before Session 5's code merges, per the deployment-order note above.

Same commit fixes scripts/sync-from-prod.sh, which would have failed against
this migration: mysqldump --no-create-info emits a positional INSERT carrying
production's column count, so any locally-added column breaks the import with
"Column count doesn't match value count". --complete-insert fixes it for this
migration and every future one, since local is always ahead of prod while a
migration is in development. Verified by simulating both table shapes locally.

## Session 5: Aggregator uses Base Unit and Unit Size
Status: done
Scope: an IngredientCatalog loader (base unit + unit sizes, keyed by ingredient name); CombineIngredients converts everything it can into the ingredient's Base Unit rather than bucketing per unit kind; a Unit Size resolves per-ingredient first, then the Unit's default; anything with no Unit Size stays a separate Amount exactly as today. Single-unit preservation from Phase 1 carries over.
Depends on: Session 4
Commit: (see git log)
Notes: Two design corrections worth remembering.

(1) A first attempt made Base Unit one bucket per Ingredient defaulting to
gram, which quietly broke volume-only ingredients - tsp+tbsp of soy sauce
stopped combining because volume no longer matched the default weight base,
undoing a Phase 1 conversion. Totals are kept per Absolute kind instead, with
Unit Sizes bridging into the Ingredient's own kind. The existing tests caught
it.

(2) Phase 1 signalled "units differed" with an empty soleUnit. Safe while only
Absolute Units entered the bucket; not once Relative Units do, because the
bare-count Unit's name is literally "". Needed an explicit `mixed` flag.

Verified live against synced production data: 1 onion + 75 g merges to 225 gram
with a Unit Size of 150 g; stays "75 gram + 1" without one; a lone count stays
"1"; 1.5 kg + 1 onion scales to 1.65 kilogram.

## Session 6: Display Unit and rounding (spec Phase 3)
Status: pending
Scope: migration for ingredient.display_unit_id; render the total in the Display Unit with the base amount in brackets ("2 tins (800 g)"); round up to a whole for Relative Display Units, natural precision for Absolute.
Depends on: Session 5
Commit:
Notes: Folded into this branch rather than shipped separately - agreed with the
user once live data showed count<->measure is the largest category (32
ingredients) and includes the most-used ingredients in the database (onion,
potato, carrot, lemon). Without Display Units, Phase 2 turns "3 onions" into
grams, so the two only read correctly together.

## Session 7: Curated data seed
Status: pending
Scope: draft Base Units, Display Units and Unit Sizes for the colliding ingredients against live data; put them to the user for review; commit the reviewed values as a migration.
Depends on: Session 6
Commit:
Notes: The review step is the point of this session - per the spec's decisions,
an LLM drafts and a person approves, rather than values being written
unsupervised. Live data to curate against: 120 colliding ingredients of 436.

## Session 8: Classification for new Ingredients (spec Phase 4)
Status: pending
Scope: extract.js proposes Base Unit / Display Unit / Unit Sizes for unseen ingredient names; carried on common.Ingredient in the save payload; written only where absent.
Depends on: Session 7
Commit:
Notes: Not in this run.
