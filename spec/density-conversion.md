# Follow-up: density-based unit conversion

Split out from [unit-normalisation.md](./unit-normalisation.md), which handles unit-type conversion (weight↔weight, volume↔volume) and count↔weight conversion via `ingredient.average_weight_grams`, but deliberately leaves two cases unresolved because both need a notion of *density* (grams per millilitre) that spec doesn't add:

1. **Weight/volume merging within a shopping list.** Unit-normalisation's aggregation algorithm keeps a weight-typed sub-group (e.g. "50g flour") and a volume-typed sub-group (e.g. "2 tablespoons flour") for the same ingredient as separate list lines, rather than guessing a conversion — see that spec's Phase 2, step 4.
2. **Imperial import conversion for `cup`.** The recipe scrapers (`pages/api/get-ingredients.js`) already normalize g/kg/tbsp/ml/l/tsp, but can't handle `cup` (or ambiguous `oz`, which could be weight or fluid ounce) — `cup`→metric isn't a fixed factor, it depends on what's being measured. These currently pass through unmatched and get surfaced for manual re-entry.

## Proposed approach

Rather than precise per-ingredient density (a lot of data-entry effort for marginal gain — e.g. the exact g/ml of "chopped parsley" isn't a meaningful constant), bucket ingredients into a handful of coarse density categories, each with one assumed g/ml figure:

- `liquid` (~1 g/ml, water-like — stock, milk, oil close enough)
- `herb`
- `spice`
- (others TBD — needs more thought, not designed in this pass)

Add a `density_bucket` field to `ingredient`, assumed g/ml per bucket stored wherever makes sense (a small lookup table, or hardcoded map to start). Use it to:

- Convert volume→grams so weight and volume sub-groups can merge in the shopping-list aggregation (resolves case 1 above).
- Convert `cup` (a volume measure) to grams on import, resolving the scraper gap for case 2 — `oz`'s weight/fluid ambiguity would still need a separate resolution (e.g. assume weight ounce unless the ingredient's bucket is `liquid`).

This would slot into the same ingredient-creation hook as unit-normalisation's Phase 3 (the LLM call that proposes `preferred_unit_id`/`average_weight_grams` for a new ingredient) — have it also propose the ingredient's `density_bucket`.

## Open questions

- What bucket list is actually needed? Three (`liquid`/`herb`/`spice`) may not cover everything (e.g. flour, sugar, grated cheese aren't any of those) — needs a pass over the real ingredient set once one exists.
- Is a flat assumed g/ml per bucket accurate enough, or does e.g. `herb` need splitting into fresh vs. dried (very different densities)?
- Precision isn't the goal here — good enough to stop obviously-related lines (like "50g flour" + "2 tbsp flour") showing as two separate list lines. Worth revisiting only if this turns out to be a common real-world pain point rather than an edge case.
