# Task to normalize ingredients



The key purpose of big shop is to be able to make a shopping list that combined ingredients from all of your recipes. The challenge in doing this is:
1. Different units: ml vs oz vs whatever cups are
2. Missing units: 200g of tomatoes vs 3 tomatoes
3. Non-standardizd units: a pinch of coriander, a bunch of parsley, a handful of peanuts.

Here's how I'd approach each of these problems:
1. Don't allow non-metric measurements. If someone attempts to import a recipe with imperial measurements convert them all to metric. This gives us standardization and allows us to change to imperial at a shopping-list view in the future (if we wanted it - which we don't).

2. We need to know the average weight of 1 of each ingredient type. e.g. if the avg weight of 1 tomato is 150g we can combine "2 tomatoes" and "150g tomatoes" into either 450g tomatoes or 3 tomatoes. We should only ever do full or half units though. We don't want to be combining to 1.3 tomatoes.

3. We'd need to have a preferred unit for each ingredient which we could normalize on. For some, a pinch might make more sense over grams, although for others we'd prefer to say a teaspoon rather than a pinch e.g. teaspoon for spices but not for herbs. The default preferred unit could be metric and then we could audit each ingredient to see if that still makes sense. When someone introuduces a new ingredient to the database - we'd use an llm to understand what the default unit should be.

## Current state (why this isn't greenfield)

Before proposing an approach, worth naming what's already there. Verified against the
code and the latest production dump (`backups/pscale_dump_bigshop_main_20240319_213654`)
as of 2026-07-26.

### Problem 1 is already solved at the input boundary — what's left is the aggregation bug

**Imperial no longer gets in.** Recipe Import was unified onto a single LLM extraction
(`lib/recipe-import/extract.js`) that all three Import Sources call — the per-site
scrapers and their partial `unitMap` (`pages/api/get-ingredients.js`,
`pages/api/third-parties/`) **no longer exist**. That prompt already instructs the model
to: prefer the metric figure when a recipe gives both; convert to metric when *only*
imperial is given (oz, lb, fl oz, cup, pint, quart); use decimals rather than fractions
and convert unicode fraction characters; take the midpoint of a range; standardize to the
units already in use; and return a **blank** unit for a bare count ("3 tomatoes" →
quantity `3`, unit `""`) rather than inventing a counting unit. Manual Entry's unit field
is a `<select>` fed by `GET /units` (`components/recipe-form/Form.tsx:312`) — no free
text.

The one remaining opening is deliberate: `insertUnits` (`service/recipe.go:381`) upserts
whatever unit string comes back, and the prompt explicitly permits inventing a new unit
("bunch", "sprig", "head") when nothing existing fits. So the unit vocabulary is still
open-ended — just no longer *imperial*.

**The aggregation bug, however, is live.** `CombineIngredients`
(`netlify-functions/recipes/internal/pkg/service/list.go:28-73` — moved out of
`app/list.go` by the recipe-writes-and-shopping-list-generation-seam work) sums quantities
keyed by ingredient **name only**; unit is not part of the key. "1 tablespoon garlic" and
"10 gram garlic" silently sum to `11` under whichever unit was seen first. Only
gram↔kilogram and millilitre↔litre are handled, via two hardcoded maps; every other unit
collision is silently wrong. `list_test.go`'s single `TestCombineIngredients` covers only
those two pairs — there is no test for a mismatched-unit collision at all, and
`evals/mock-api-server.js:128` carries a comment admitting real conversion isn't
implemented. A second, quieter defect sits in the same loop: a quantity that fails
`strconv.ParseFloat` is skipped by an `if err == nil` with no `else`, so an unparseable
line vanishes from the Shopping List with no error anywhere.

So problem 1 restated for where the code actually is: **make aggregation unit-aware**, not
"stop imperial getting in".

### The unit vocabulary is tiny; the ingredient set is where the cardinality is

Production has **13 unit rows**: `""` (the blank count sentinel), gram, kilogram,
millilitre, litre, teaspoon, tablespoon, clove, tin, pinch, packet, bottle, slice —
against ~300 ingredients and ~930 ingredient lines. Classifying units is therefore a
hand-curation job measured in minutes, not a problem needing automation. Only the
ingredient side has enough rows, and enough growth, to justify any.

### The data model for problems 2 and 3 is entirely new

`unit(id, name)` and `ingredient(id, name)` are bare lookups (`migrations/001_init.sql`).
No unit type (weight/volume/count), no conversion factor, no average weight, no preferred
unit, no density.

### The Shopping List is keyed by item name, end-to-end

One line per name, carrying exactly one quantity and one unit. `GetShoppingList` returns
`map[string]*common.ListIngredient`; the frontend renders `Record<string, ListIngredient>`
and displays a single `{quantity} {unit}` string
(`components/shopping-list/ShoppingList/Item.tsx:25`); `BuyListItem` toggles bought state
with `WHERE name = ?` (`service/list.go:342`). CONTEXT.md states this as a domain rule
("identified by its display name alone").

This matters for design: **"leave the weight lines and the volume lines as two separate
lines" is not a small change.** It breaks the name-as-key contract in the DB, in the API
response shape, and in the buy toggle simultaneously. Any approach that gives up on
merging a group has to either pick one representation anyway, or change that contract on
purpose.

### Mixed-number quantities are hypothetical, not observed

`part.quantity` and `list.quantity` are `varchar(20)` commented "mixed number", but every
one of the ~930 production values parses as a plain decimal (`1`, `2`, `0.5`, `0.25`,
`200`…). Combined with the extraction prompt now forbidding fractions, `"1 1/2"` is a risk
worth guarding cheaply, not a live problem. The silent drop described above is the real
defect here — the input format is not.

### An LLM classifier would be this codebase's first Go-side AI call

There is a well-established LLM path (`lib/recipe-import/extract.js`, called by
`parse-recipe-url.ts`, `parse-recipe-text.ts`, `recipe-image.ts`), but it extracts *a
recipe from a document* — nothing classifies a Global Catalog row. More constraining:
every LLM call in this app is a **Next.js API route (Node)**, and the Go module has no
OpenAI dependency at all, while ingredient creation happens in the **Go** service
(`insertIngredients`, `service/recipe.go`). "Classify an ingredient when it's created"
therefore means either introducing OpenAI to the Go service or moving the hook to the
Next.js side — an architectural choice, not an implementation detail.

### Latent defect in the same code any rewrite will touch

`AddIngredientListItems` stores only the **first** contributing recipe's id per list row,
and `GetRecipesFromList` derives the list's Recipe set from `SELECT DISTINCT recipe_id`.
A Recipe whose every ingredient was already contributed by an earlier Recipe would
therefore leave no row carrying its id, and drop out of the list's recipe set. Rare, and
pre-existing rather than caused by this work — but it lives in the function being
rewritten, so it should at least not get worse.

### How bad is the problem, in real numbers

Measured against live production data (synced 2026-07-26 via
`scripts/sync-from-prod.sh`): **120 of 436 ingredients (28%) are used with more than one
Unit**, so this is a routine occurrence rather than an edge case. Grouped by what each
would need in order to combine:

| Ingredients | Requires | Examples |
| --- | --- | --- |
| **36** | nothing — same dimension, pure conversion | tsp↔tbsp, g↔kg, ml↔l |
| **32** | average weight of one | onion, potato, carrot, lemon, chicken breast |
| **20** | pack size | coconut milk, spinach, asparagus, cherry tomato |
| **20** | grams per millilitre | flour, butter, caster sugar, breadcrumbs |
| **10** | a decision about `pinch` | black pepper, chilli flakes, nutmeg, cinnamon |
| **2** | two Relative Units only | garlic, green beans |

The **largest single win needs no new data at all** — same-dimension conversions fix 36
ingredients for free, which is what Phase 1 shipped.

**Correction, recorded rather than quietly edited:** an earlier draft of this section used
a 2024 database dump and concluded that weight↔volume (16) was a larger category than
count↔weight (12), and therefore that the original plan's priorities were inverted. Live
data says the opposite — count↔measure is **32**, comfortably the largest category needing
curated data, against 20 for weight↔volume. The original problem statement's instinct
(point 2, average weight per ingredient) was right. What this doesn't change is the design:
one relation still serves both, and the case for that is stronger now that both categories
are large rather than one dominating.

It does change sequencing, though — see Phase 3, which the count group depends on to read
properly.

## Proposed approach

### The model

Four concepts, defined in [CONTEXT.md](../CONTEXT.md) and used verbatim in schema and code:

- **Absolute Unit** — fixed size regardless of Ingredient: gram, kilogram, millilitre,
  litre, teaspoon, tablespoon. Carries a `kind` naming its dimension (weight or volume)
  and a `factor` into that dimension's base (gram or millilitre).
- **Relative Unit** — size depends on the Ingredient: the blank count sentinel, clove,
  slice, tin, packet, bottle, pinch. No factor.
- **Base Unit** — the Absolute Unit one Ingredient's Amounts are added up in. Gram by
  default; millilitre for things bought by volume.
- **Unit Size** — how much one of a given Unit of a given Ingredient comes to, expressed
  in that Ingredient's Base Unit.

The load-bearing idea is that **Unit Size is one relation, not three features**. "One
potato is 180 g" (average weight), "one tin of coconut milk is 400 ml" (pack size) and
"one tablespoon of flour is 8 g" (density) are the same question asked about different
Units. Because the value is stated in the Ingredient's *own* Base Unit, `tin → 400` is
simultaneously correct for chopped tomatoes (400 g) and coconut milk (400 ml).

A Unit may declare a **default Unit Size** where it genuinely doesn't vary by Ingredient
(pinch ≈ 0.3, clove ≈ 5, tin ≈ 400); a per-Ingredient value overrides it. Units whose size
really does vary — packet, bottle, slice, and the blank count — declare no default and are
strictly per-Ingredient.

### Schema

```sql
-- Absolute Units get kind + factor; Relative Units get an optional default size.
-- `kind`, not `dimension`: weight and volume are dimensions, but 'relative' is
-- the absence of one, and the name still reads correctly if the relative values
-- are later split into their real sub-kinds (pack, portion, vague).
ALTER TABLE unit ADD kind ENUM('weight','volume','relative') NOT NULL DEFAULT 'relative';
ALTER TABLE unit ADD factor       DECIMAL(12,4) NULL;  -- absolute only: into gram / millilitre
ALTER TABLE unit ADD default_size DECIMAL(12,4) NULL;  -- relative only: default Unit Size

ALTER TABLE ingredient ADD base_unit_id    INT NULL;   -- FK unit; NULL is read as gram
ALTER TABLE ingredient ADD display_unit_id INT NULL;   -- FK unit; NULL means show in Base Unit

CREATE TABLE ingredient_unit_size (
  ingredient_id INT NOT NULL,
  unit_id       INT NOT NULL,
  size          DECIMAL(12,4) NOT NULL COMMENT 'one <unit> of <ingredient>, in its base unit',
  PRIMARY KEY (ingredient_id, unit_id),
  CONSTRAINT fk_ius_ingredient FOREIGN KEY (ingredient_id) REFERENCES ingredient (id),
  CONSTRAINT fk_ius_unit       FOREIGN KEY (unit_id)       REFERENCES unit (id)
);
```

`list` needs **no schema change at all** — it already has `quantity` and `unit_id` per row
and has no unique constraint on `name`, so an Ingredient Item with two Amounts is simply
two rows. `BuyListItem`'s `WHERE name = ?` already updates them together, which is exactly
the desired one-checkbox behaviour.

### The algorithm

`CombineIngredients` is replaced by a **pure** function — catalog data is passed in as an
argument, never queried inside — so it stays as directly testable as it is today (see
"Things to get right").

Per Ingredient Line:

1. Parse the quantity, accepting decimals, fractions and mixed numbers. **If it can't be
   parsed, emit it as its own verbatim, unmergeable Amount — never drop it.**
2. Resolve the Ingredient's Base Unit (default gram).
3. If the Unit is Absolute *and* in the Base Unit's dimension, convert with `unit.factor`.
   This is the free path: l→ml, kg→g, tbsp→tsp.
4. Otherwise look up a Unit Size — the per-Ingredient row first, then the Unit's default.
   This one path covers Relative Units *and* Absolute Units in the other dimension (a
   tablespoon of a gram-based ingredient), which is how density stops being a separate
   feature.
5. If no Unit Size exists, keep the Amount as its own unmergeable Amount. Honest, and it
   silently improves the moment a Unit Size is supplied.

Then, per Ingredient: sum the convertible Amounts into the Base Unit and render as
`Display Unit → base amount in brackets` if a Display Unit is set, otherwise in the Base
Unit, scaling up within the dimension (g→kg, ml→l) as today. Rounding:

- **Relative Display Unit → round up to a whole.** You can't buy 1.5 tins, so a half is
  never a purchasable instruction. Also guarantees the cook is never left short.
- **Absolute Display Unit → natural precision**, no half-rounding. 1123 g reads as 1.1 kg.

Any unmergeable Amounts are appended to the same Item.

### Phase 1 — Unit-aware aggregation, no per-ingredient data

Add `kind` and `factor` to `unit` and classify the 13 existing rows. Rewrite the
aggregator to key on ingredient identity, group by dimension, and convert
within a dimension via `factor`. Make a Shopping List Item carry one or more Amounts, all
the way through `common.ListIngredient`, `GetIngredientListItems` (grouping rows by name),
the TypeScript types and `Item.tsx`. Fix the parse-failure drop.

Ships the live bug fix, merges the 18 same-dimension collisions, and turns the other 58
from silently wrong into visibly honest — **without a single curated data point.**

### Phase 2 — Base Unit and Unit Size

Add `base_unit_id`, `ingredient_unit_size` and `unit.default_size`. Seed: unit-level
defaults for pinch/clove/tin, a Base Unit of millilitre for the liquids, and per-ingredient
Unit Sizes for the ~76 colliding ingredients. Values drafted with LLM help offline, then
reviewed by a person and committed as a migration.

Most remaining collisions now merge.

### Phase 3 — Display Unit and rounding

Add `display_unit_id`, the round-up rule, and the bracketed base amount in `Item.tsx`.
This is where "800 g chopped tomatoes" becomes "2 tins (800 g)".

### Phase 4 — Classification for new Ingredients

Extend `lib/recipe-import/extract.js` to return, for ingredient names not in
`knownIngredients`, a proposed Base Unit / Display Unit / Unit Sizes. These ride along on
each `common.Ingredient` in the `POST /recipe` payload and are written inside the existing
save transaction, **only where the existing value is absent**.

The curated seed covers the 300 ingredients that exist; this covers everything new. Since
`appendIngredients` (`components/recipe-form/Form.tsx:154`) is the only way an ingredient
row is ever added, and it's fed exclusively by parsed output, every new Ingredient passes
through this call — there is no path to route around it.

## Decisions made (grilled — do not re-litigate without a load-bearing reason)

- **Normalisation happens at read time.** `part` records what the Recipe said, verbatim,
  forever; all conversion happens in `GenerateShoppingList`. A corrected Unit Size then
  improves every existing Recipe with no backfill, and no original data is ever destroyed.
- **Unit Size is one relation covering average weight, pack size and density**, rather
  than separate scalars on `ingredient` plus a deferred density feature. Stating the value
  in the Ingredient's own Base Unit is what makes one relation sufficient.
- **Base Unit is per-Ingredient, defaulting to gram** — not a global "always grams".
  Buys free l↔ml for liquids and free kg↔g for solids with zero per-ingredient data.
- **A Shopping List Item carries one or more Amounts.** When a group can't be merged the
  line reads "50 g + 2 tbsp" — one line, one checkbox, nothing invented and nothing
  dropped. Costs no `list` schema change; changes the API response shape and `Item.tsx`.
- **Unit-level default Unit Sizes exist, overridden per Ingredient.** Rejected both
  strictly-per-Ingredient (needlessly retypes "pinch = 0.3" ten times) and defaults-only
  (can't express counts at all, which is problem 2 in its entirety).
- **Display Unit is a third, separate concept** from Base Unit and Unit Size, and the base
  amount stays visible in brackets alongside it. Explicitly to defuse the tins-aren't-equal
  risk: if a tin is really 390 g, the assumption is on screen where it can be judged.
- **Round up to a whole for Relative Display Units; natural precision for Absolute.** A
  deliberate departure from the original spec's "full or half units" — halves aren't
  purchasable, so they'd only be re-rounded in the shopper's head at the shelf.
- **Curate the seed; classify only what's new.** An LLM drafts the seed offline for human
  review rather than writing to the database unsupervised; runtime classification is
  reserved for ingredients that don't exist yet.
- **Classification is folded into the existing `extract.js` call**, not a new endpoint or a
  Go-side AI call. The Go module has no OpenAI dependency and shouldn't gain one — holding
  a write transaction open across a call to OpenAI on Lambda is the worst available option.
- **Classified data rides on each `common.Ingredient` in the recipe save payload.** Next.js
  has no database access whatsoever, so the data must travel through the Go API; per-
  ingredient fields land in the existing transaction, and `insertIngredients` already
  iterates exactly these.
- **Unit Sizes are global and single-locale (UK).** Recorded as a known limitation in
  CONTEXT.md rather than designed around. Recipe Import already metricates on the way in,
  so the exposure is narrow — Relative Units, chiefly pack sizes.
- **"Never overwrite a human's value" is enforced by only classifying Ingredients that
  don't exist yet** - detected by their having no Ingredient Lines - rather than by
  checking whether the column is still unset. No provenance columns in v1.

  **Corrected during Phase 4.** This decision originally read "only write where the value
  is absent", on the reasoning that NULL-vs-set fully expressed the rule. It does not:
  NULL in `base_unit_id` means both *never curated* and *curated as the default, gram*.
  Onion is deliberately gram, so it is NULL, so an unset-column guard let an import flip it
  to millilitre. Caught by testing against a live database; the unit tests could not have
  found it, since they assert the shape of the SQL rather than what it means. Restricting
  to new Ingredients is also a better fit for what the feature is for - the curated set
  covers what exists, classification covers what arrives.
- **No admin panel in v1.** Curated values live in a seed migration; corrections are SQL.
  With one user and ~76 rows this is genuinely viable, and it gets the engine in front of
  you sooner. Expect to want the panel fairly soon.
- **Four independently shippable phases**, chosen specifically because Phase 1 fixes the
  live correctness bug without depending on any curated data.
- **Testing**: Go table tests over the pure aggregator (one per collision category found in
  the real data), Vitest on `Item.tsx` for multi-Amount and bracket rendering, and an
  extended `e2e/shopping-list.spec.ts`.

## Things to get right when building this

### Migration

- **An `UPDATE ... WHERE name = ...` classification step in a migration only works against
  a database that already has those rows.** On a fresh database every migration runs
  *before* any seed data, so classifying units or ingredients by name matches nothing. This
  bites Phase 1's unit classification and all of Phase 2's seed. Local fixtures must set
  these values at insert time in `docker/mysql-seed/dev-seed.sql`; production applies them
  as a deliberate manual step, after confirming the real rows exist.
- Per this repo's manual-migration workflow, schema changes must reach production *before*
  the code depending on them. Deploying first turns every units/ingredients request into a
  missing-column error rather than degrading gracefully.
- `unit` has `UNIQUE (name)` (migration 016) and its `id = 1` row is the **blank-name count
  sentinel**. Classify it as Relative, and never give it a `default_size` — a count means
  something different for every Ingredient. That row is also what `AddExtraListItem` uses
  as a placeholder, so it must keep working untouched.
- `ingredient` has `UNIQUE (name)`, so seeding by name is safe.

### Huma / OpenAPI

- **Huma infers required-ness from JSON tags** — `common.Recipe.ID` already carries a
  comment about exactly this. Every new field on `common.Ingredient` must be `omitempty`
  (or a pointer), or a save request that omits them fails validation and every existing
  client breaks.
- `docs/openapi.yaml` is code-generated; the build's drift check will fail until it's
  regenerated.

### Aggregation

- **Keep the aggregator pure.** The seam spec established the hard way that anything taking
  a concrete `*sql.DB` cannot be faked in Go — `sql.Row` has no exported constructor. Pass
  units, Base Units and Unit Sizes in as an argument; load them in `GenerateShoppingList`.
- Key the grouping on ingredient identity **and** unit. The bug is that unit isn't part of
  the key at all — not that the key is a name. Name is a sound identity here: `ingredient`
  has `UNIQUE (name)` (migration 002) and every name the aggregator sees is read back from
  that table, so name and id are bijective in this data. Keying on name avoids adding an
  `id` to `common.Ingredient`, which is a request payload as well as a response, for no
  observable gain. (Corrected during implementation — an earlier draft of this bullet
  asserted name-keying was "half of the current bug", which was simply wrong.)
- The is-bought carry-forward matches on name and still works unchanged with several rows
  per name.
- `Item.tsx` must keep rendering Extra Items correctly — they pass no `item` at all, and
  their `list` rows carry placeholder `quantity = 0` and `unit_id = 1`.
- `evals/mock-api-server.js:128` carries a comment noting conversion isn't implemented;
  update it and the mock's behaviour alongside the real thing.
- Don't invent a conversion where no Unit Size exists. Emitting a second Amount is the
  designed outcome, not a failure — it's the same "never silently produce a wrong number"
  principle that motivates fixing the bug at all.

### Classification

- Must complete **within the request**. Lambda can freeze the execution environment the
  moment a response is sent, so nothing may be left in flight.
- A classification failure must never fail a recipe save. The gap simply persists, and the
  list degrades to multiple Amounts — which is a supported state, not an error.
- Validate what comes back against the `unit` table before writing. A model returning
  `"cups"` as a Base Unit must be rejected, not upserted into the Global Catalog.
- The user may delete an ingredient row in the form after extraction; classified data for a
  name that isn't in the saved payload is simply not written.

## Explicitly out of scope

- **Purchase units and unit-per-purchase ratios.** A garlic bulb has no fixed number of
  cloves, but you buy bulbs. Worth noting the Ingredient here is literally named "Garlic
  Clove" and 48 of its 51 lines are a bare count, so the list already reads "6 Garlic
  Clove" and the shopper infers a bulb perfectly well. This only becomes load-bearing when
  something has to *order* the garlic automatically.
- **Locale-scoped or Account-scoped Unit Sizes.** Deferred until there's a second locale to
  learn the real requirements from; Account-scoping would additionally require revisiting
  [ADR-0001](../docs/adr/0001-global-ingredient-catalog.md).
- **The admin panel**, and the `curated`/`classified` provenance columns that only it would
  display.
- **Imperial display.** Storing metric leaves the door open, and the original spec is
  explicit that it isn't wanted.
- **Backfilling `list.recipe_id` properly** (the latent defect above), and batching
  `GenerateShoppingList`'s N sequential recipe fetches — both pre-existing, both noted in
  the seam spec as separate concerns.
