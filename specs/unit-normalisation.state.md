---
spec: specs/unit-normalisation.md
status: in-progress
branch: implement/unit-normalisation
pr:
---

**Deployment order (do not lose before the PR merges):** migration 019 must be
applied to production *before* Session 2's code deploys. Session 1 alone is safe to
ship in either order because nothing calls `GetUnitCatalog` yet; from Session 2 on,
code without the migration fails with `Unknown column 'kind'`.

This run covers **Phase 1 only** (Sessions 1-3), per the user's `/implement phase 1`.
Sessions 4-6 map to the spec's Phases 2-4 and are left `pending` so a later run resumes
cleanly from step 1 of the implement skill.

Branch point: `cb6eff6` (the spec/design commit).

## Session 1: Unit kinds and factors
Status: done
Scope: migrations/019_unit_kind.sql adds `kind` + `factor` to `unit` and classifies the six Absolute Units by name; docker/mysql-seed/dev-seed.sql sets them at insert time (migrations run before seed data on a fresh DB, so the migration's UPDATE-by-name matches nothing there); service/units.go gains a UnitCatalog loader. No behaviour change.
Depends on: none
Commit: (see git log - recommitted after the kind rename below)
Notes: Test gate: go fmt/vet/test clean via the api container (no Go
toolchain on this host); no OpenAPI or api.d.ts drift. Both migration paths
exercised against real MySQL with identical results - the fresh-database
path in an isolated throwaway compose project (COMPOSE_PROJECT_NAME=
bigshop-migcheck, torn down with -v afterwards, so the local dev volume and
its non-seed recipe survived), the existing-database path applied to the
local dev DB. GetUnitCatalog run against the real schema via a throwaway
main to confirm DECIMAL scans into sql.NullFloat64 and ENUM into string,
and that the unknown-unit fallback returns Relative; throwaway deleted.
All of the above re-run after the rename.

Review gate: run inline rather than via the code-review skill's parallel
sub-agents - all four agent attempts died on transient API 529s, so this
axis is weaker than intended (self-review) and worth re-running properly
if the opportunity arises. 0 findings requiring a fix.

One judgement call raised and then acted on: the column was originally
`dimension ENUM('weight','volume','relative')` per the spec, which is a
category error - weight and volume are dimensions, 'relative' is the
absence of one. Renamed to `kind` after discussion with the user, and the
spec updated to match. Done before any merge, so no second migration was
needed. The related trap (every Relative Unit shares KindRelative, so a tin
and a pinch compare equal on Kind alone) is now documented on UnitInfo:
callers must check Factor.Valid, not Kind alone.

Also noted: one review sub-agent edited .claude/skills/implement/SKILL.md
before dying (removing the reference to the nonexistent `verify` skill).
Reverted - reviews must be read-only.

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
