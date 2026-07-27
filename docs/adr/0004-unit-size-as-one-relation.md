# Unit Size is one relation, not three features

Status: accepted

Combining a Shopping List needs three seemingly different facts: the average weight of one item ("1 potato is 180g"), the size of a pack ("1 tin of coconut milk is 400ml"), and an ingredient's density ("1 tablespoon of flour is 8g"). We model all three as a single relation — a **Unit Size**, stating how much one of a given Unit of a given Ingredient comes to, expressed in that Ingredient's own **Base Unit** — rather than as separate `average_weight_grams` and `density_bucket` fields on `ingredient`.

The unlocking detail is that the value is stated in the Ingredient's *own* Base Unit rather than always in grams. That makes `tin → 400` simultaneously correct for chopped tomatoes (400g) and coconut milk (400ml), which is what lets one relation cover cases that otherwise look unrelated. It also means Absolute Units used outside their own dimension (a tablespoon of a gram-based ingredient) resolve through exactly the same lookup as Relative Units like `tin` — so there is one branch in the aggregation algorithm, not four.

## Considered options

The rejected alternative is written down and looks reasonable, which is the main reason this ADR exists — see `specs/archive/unit-normalisation-old.md` and `specs/archive/density-conversion.md`. That plan put `average_weight_grams` and `preferred_unit_id` on `ingredient`, handled weight↔volume merging as a *separate, later* spec built on coarse density buckets, and left informal count units (bunch, handful, pinch) explicitly unresolved because a single `average_weight_grams` couldn't represent both "1 tomato" and "1 pinch".

Two things decided it. A quarter of all ingredients are used with more than one Unit, and the categories needing curated data are all substantial — no single one dominates enough to justify building for it and deferring the rest. And the real unit vocabulary is only 13 rows, of which 6 are absolute; everything else needed per-ingredient data anyway, which is precisely what the one relation provides.

**Figures corrected after the fact.** This ADR originally argued from a 2024 database dump that weight↔volume (16) was a *larger* category than count↔weight (12), and that the old plan had therefore deferred the bigger half. Live data (2026-07-26: 120 of 436 ingredients colliding) says the reverse — count↔measure is 32 against weight↔volume's 20. The decision recorded here is unaffected, and if anything better supported: one relation serving both matters more when both are large. But the specific comparison that motivated it was wrong, and is corrected here rather than left to mislead a future reader.

## Consequences

- More rows to populate than a scalar column would need — roughly 100 rather than a field per ingredient. Acceptable because a row is only needed where a collision actually occurs, and an absent Unit Size is a supported state (the Shopping List Item simply carries more than one Amount — see [ADR-0005](./0005-shopping-list-items-carry-multiple-amounts.md)).
- Reversing this means both a schema change and recurating every value, so it should be treated as settled unless something structural changes.
- Unit Sizes are part of the Global Catalog and therefore shared across Accounts and single-locale — a tin is 400g here and ~411g in the US. Recorded as a known limitation in CONTEXT.md; see [ADR-0001](./0001-global-ingredient-catalog.md) for why the catalog is global in the first place.
