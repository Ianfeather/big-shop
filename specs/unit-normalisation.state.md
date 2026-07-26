---
spec: specs/unit-normalisation.md
status: in-progress
branch: implement/unit-normalisation
pr: https://github.com/Ianfeather/big-shop/pull/63
---

**Deployment order (do not lose before the PR merges):** migration 019 must be
applied to production *before* Session 2's code deploys. Session 1 alone is safe to
ship in either order because nothing calls `GetUnitCatalog` yet; from Session 2 on,
code without the migration fails with `Unknown column 'kind'`.

This run covers **Phase 1 only** (Sessions 1-3), per the user's `/implement phase 1`.
Sessions 4-6 map to the spec's Phases 2-4 and are left `pending` so a later run resumes
cleanly from step 1 of the implement skill.

Branch point: `cb6eff6` (the spec/design commit).

**PR #63 is open covering Session 1 only** - opened early at the user's request rather
than at the end of the run, so the schema layer can land in master while Sessions 2-3
continue. Overall status stays `in-progress`: the spec is not complete, so this spec and
state file do NOT move to `specs/completed/` yet.

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
Status: pending
Scope: service/quantity.go (decimals, fractions, mixed numbers); common.Amount and ListIngredient.Amounts replacing the Unit/Quantity pair; CombineIngredients rewritten as a pure function taking the UnitCatalog, bucketing by unit kind and emitting one Amount per bucket; AddIngredientListItems writes one row per Amount and GetIngredientListItems groups them back by name; openapi.yaml + api.d.ts regenerated; Go table tests per collision category.
Depends on: Session 1
Commit:
Notes: Keyed on ingredient name rather than ingredient_id - a deliberate deviation from the spec's wording, agreed during planning. `ingredient.name` is UNIQUE (migration 002) and every name here comes from that table, so it is already a canonical identity; adding an `id` to `common.Ingredient` would change a request payload for no observable gain.

## Session 3: Frontend rendering and end-to-end coverage
Status: pending
Scope: Item.tsx renders Amounts joined with "+", suppressing the blank count unit; pages/list.tsx buildMockIngredients and mocks/ updated to the new shape; evals/mock-api-server.js conversion comment and behaviour; Vitest for merged and unmerged Amounts; e2e/shopping-list.spec.ts extended with a mixed-unit scenario.
Depends on: Session 2
Commit:
Notes:

## Session 4: Base Unit and Unit Size (spec Phase 2)
Status: pending
Scope: base_unit_id, ingredient_unit_size, unit.default_size, and the curated seed for the ~76 colliding ingredients.
Depends on: Session 3
Commit:
Notes: Out of scope for this run.

## Session 5: Display Unit and rounding (spec Phase 3)
Status: pending
Scope: display_unit_id, round-up-to-whole for Relative Display Units, bracketed base amount in Item.tsx.
Depends on: Session 4
Commit:
Notes: Out of scope for this run.

## Session 6: Classification for new Ingredients (spec Phase 4)
Status: pending
Scope: extract.js proposes Base Unit / Display Unit / Unit Sizes for unseen ingredient names; carried on common.Ingredient in the save payload; written only where absent.
Depends on: Session 5
Commit:
Notes: Out of scope for this run.
