
## Proposed approach

Splitting into phases so each lands independently and the riskiest/most novel piece (the LLM call) isn't a blocker for fixing the bug that exists today.

### Phase 1 — Schema foundations

Extend the two lookup tables with the metadata the later phases need:

- `unit`: add `unit_type` (`weight` | `volume` | `count`) and `base_factor` (numeric — how many of the table's base unit, e.g. grams for weight, millilitres for volume, one for count, does one of this unit represent). This replaces the two hardcoded conversion maps in `list.go` with data, and lets us add units later (e.g. `stick`, `cup`) without a code change.
- `ingredient`: add `average_weight_grams` (nullable numeric) and `preferred_unit_id` (nullable FK to `unit`, single value — not varied per use-case). Nullable because the backfill (Phase 3) runs after this migration, not as part of it.
- Fix `part.quantity` / `list.quantity` parsing to handle fractions/mixed numbers (e.g. via a small parse helper), since half-unit rounding in Phase 2 depends on quantities parsing correctly in the first place.

### Phase 2 — Rewrite the aggregation algorithm

Replace `CombineIngredients` with a unit-aware version:

1. Group by `ingredient_id` (not name).
2. Within a group, split lines into sub-groups by `unit.unit_type` (`weight`, `volume`, `count`) and convert each sub-group to its own base unit using `unit.base_factor` (weight → grams, volume → millilitres, count stays as count). `unit_type` is what makes this safe — grams and millilitres aren't interchangeable without knowing the ingredient's density, so `base_factor` alone can't tell the algorithm which units are compatible to sum directly.
3. If an ingredient has both a `weight`/`volume` sub-group and a `count` sub-group (e.g. "3 tomatoes" + "150g tomatoes"), use `ingredient.average_weight_grams` to convert the count entries to grams and merge into the weight sub-group. This is the one cross-type conversion this spec adds data for.
4. If an ingredient has both a `weight` sub-group and a `volume` sub-group (e.g. "50g flour" + "2 tablespoons flour"), **don't merge them** — that needs a density (grams per millilitre) which isn't part of this spec. Keep them as separate shopping-list lines, same "don't silently produce a wrong number" principle as the bug fix itself.
5. Round each combined total **up** to the nearest whole or half unit before converting back for display (per the spec's "don't combine to 1.3 tomatoes" rule) — e.g. 1.3 tomatoes → 1.5, 1.6 → 2. Rounding up rather than to nearest so the shopper never comes up short.
6. Display in `ingredient.preferred_unit_id` if set, else fall back to today's gram/kilogram, millilitre/litre scale-up behaviour.

This directly fixes the silent-sum bug from today's implementation, independent of whether Phase 3/4 ship.

### Phase 3 — LLM default classification, for new ingredients and backfilled onto existing ones

When an ingredient is created for the first time (manual form save, photo-extraction confirm, or scraper import confirm — all three paths currently call the same ingredient-creation code, so this should hook in at that shared point rather than per-entrypoint), call an LLM once to propose `preferred_unit_id` and `average_weight_grams`. Store as a normal (non-flagged) value — audit is a separate, later concern, not a blocker to ingredients being usable immediately.

Once this is in place, run it as a one-off backfill against every existing ingredient too, rather than leaving pre-existing rows `NULL` until next touched — so normalization applies to the whole current ingredient set immediately, not just ingredients created going forward.

### Phase 4 — Audit tooling

A simple admin-only view listing ingredients with their `preferred_unit`/`average_weight_grams`, editable inline, so the LLM-assigned defaults (both the backfill and new-ingredient classifications from Phase 3) can be corrected over time. Not required for Phase 1-3 to function — ingredients work with LLM-assigned defaults immediately, this just makes them correctable.

### Out of scope for now — density-based conversion

Two cases need a notion of ingredient density (grams per millilitre) that this spec doesn't add data for: merging weight/volume sub-groups in Phase 2 (step 4 keeps them as separate lines instead), and scraper import of `cup`/ambiguous `oz`. Split out into [density-conversion.md](./density-conversion.md) as a follow-up spec rather than designed here.

## Things to get right when building this

Constraints and gotchas worth knowing before (re)building this, independent of any particular implementation.

### Migration

- A migration that adds the new columns and classifies pre-existing unit rows by name (`gram`, `kilogram`, `millilitre`, `litre`, `teaspoon`, `tablespoon` → their weight/volume type and factor) is enough — every other unit should fall through to the column defaults (`unit_type = 'count'`, `base_factor = 1`) rather than being enumerated explicitly.
- **Gotcha: an `UPDATE ... WHERE name = ...`-style classification step in a migration only works against a database that already has those rows.** On a freshly-provisioned database, all migrations run before any fixture/seed data is inserted — so a migration that tries to classify rows by name before they exist will silently match nothing. This only shows up when a dev database is wiped and rebuilt from empty, not on every dev run, so it's easy to miss. Any local fixture data needs its classification set directly at insert time rather than relying on the migration's `UPDATE` to backfill it later.
- The migration needs to be applied to production manually (per this repo's manual-migration workflow) *before or alongside* deploying any code that depends on the new columns — application code should not assume the schema change has landed just because the code has deployed, since deploying first would turn every request touching units/ingredients into a missing-column error rather than a graceful degradation. Verify the classification-by-name will actually match production's real unit rows before relying on it.

### LLM classification of ingredients

- Whatever runs the classification must complete **within the request** that creates the ingredient, not as a background/fire-and-forget task — this app runs on AWS Lambda, which can freeze the execution environment immediately after a response is sent, so anything still in flight past that point may never resume. Any approach that defers the LLM call needs to account for that platform constraint rather than assuming it'll eventually complete.
- Classification should only fill gaps, never overwrite a value a human has already corrected — otherwise a manual audit correction can get silently clobbered by a later reclassification.
- Classifying every *pre-existing* ingredient (as opposed to new ones going forward) should be a deliberate, manually-triggered one-off action rather than something that runs automatically as part of a migration or deploy.

### Aggregation

- Quantities need to support fractions and mixed numbers (e.g. "1 1/2"), not just plain decimals — this shows up regularly in real recipe data from photo extraction and scrapers. Half-unit rounding depends on quantities parsing correctly in the first place.
- Don't merge weight and volume quantities for the same ingredient without real density data — keep them as separate shopping-list lines rather than guessing. This is the same "don't silently produce a wrong number" principle that motivates fixing the aggregation bug at all, and is why density-based conversion is deliberately a separate follow-up ([density-conversion.md](./density-conversion.md)) rather than something to guess at here.

### Audit / correction UI

- Since this app has no admin-role concept anywhere, a page for correcting LLM-assigned defaults doesn't need role-gating beyond normal login — just don't link it from primary navigation. Revisit only if the app ever grows a real permissions model.

### Additional call out from claude:
Informal count units (bunch/handful/pinch) vs. true discrete counts (1 tomato, 1 egg).** Both currently fall under `unit_type = 'count'` in the proposed `unit-normalisation.md` schema, but a single `average_weight_grams` per Ingredient can't correctly represent both. Punted for now, same as `density-conversion.md` already punts on weight/volume merging — needs its own resolution before Phase 3 of `unit-normalisation.md` ships.
