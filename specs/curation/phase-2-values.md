# Phase 2 curation - proposed values for review

Draft for `specs/unit-normalisation.md` Session 7. **Nothing here is committed to the
database yet.** Per the spec's decisions, an LLM drafts and a person approves - so read
this, correct anything wrong, and it becomes a migration.

Measured against live production data (472 ingredients, 1607 ingredient lines): 120
ingredients are used with more than one Unit. 36 of those need nothing - same-dimension
conversions already work. The remaining 84 are below.

Values are in the ingredient's **Base Unit** - grams unless the ingredient is listed as a
liquid, in which case millilitres.

## 1. Unit-level defaults

Set once on the Unit, override per ingredient if wrong. These three cover ~34 ingredients.

**These values are in each ingredient's own Base Unit, not in grams as such** — which is
why one number can be right for two different dimensions. In practice:

| Unit | Default size | Reads as | Why |
| --- | --- | --- | --- |
| `pinch` | 0.5 | **grams**, always | All 20 ingredients using it are dry goods — herbs, spices, sugar, salt. Nothing volume-based is ever pinched, so this is only ever 0.5 g. |
| `clove` | 5 | **grams**, always | Only ever garlic. |
| `tin` | 400 | **grams or millilitres**, depending | 10 of its 12 users are weight-based (400 g of chopped tomatoes, kidney beans, tuna); coconut milk and coconut cream are volume-based, where the same 400 correctly means 400 ml. This is the one place the base-unit-relative rule currently does real work. |

A note on precision: `pinch` barely matters. Its biggest users are fresh coriander and
parsley, and a typical shopping list has one or two pinches on it — under a gram either
way, vanishing into a total measured in tens of grams. Its real job is to stop a stray
"2 pinch" cluttering a line that already says "1 packet", not to be accurate.

## 2. Liquids - Base Unit becomes millilitre

13 ingredients. Everything else stays gram (the default).

`orange juice`, `white wine` and `worcestershire sauce` stop colliding once section 7's
recipe fixes land, so their Base Unit is no longer load-bearing - kept anyway, since it's
correct and costs nothing.

| Ingredient |
| --- |
| almond milk |
| chicken stock |
| coconut cream |
| coconut milk |
| double cream |
| olive oil |
| orange juice |
| salad dressing |
| sesame oil |
| soy sauce |
| vegetable oil |
| white wine |
| worcestershire sauce |

## 3. Average weight of one (the count group)

33 ingredients - the largest category, and your most-used ones. (`lemon` and `pumpkin` were
here until the recipe fixes in section 7 removed their collisions entirely.)

| Ingredient | One of them is | Note |
| --- | --- | --- |
| apples | 150 |  |
| asparagus | 20 | a spear |
| avocado | 200 |  |
| bacon rashers (smoked) | 25 |  |
| cabbage | 900 |  |
| carrot | 80 |  |
| cherry tomato | 15 |  |
| chicken breast | 180 |  |
| chicken thigh | 120 |  |
| chicken thighs (boneless) | 120 |  |
| chorizo | 225 | a ring |
| curry leaves | 0.3 | one leaf |
| egg whites | 33 | one egg white |
| garlic clove | 5 |  |
| ginger | 30 | a thumb |
| lasagne sheets | 15 |  |
| mint | 5 | a sprig |
| mozzarella | 125 | a ball |
| new potato | 50 |  |
| onion | 150 |  |
| plum tomato | 70 |  |
| potato | 180 |  |
| radish | 15 |  |
| red onion | 150 |  |
| ripe medium tomato | 120 |  |
| ripe tomatoes | 120 |  |
| rosemary | 5 | a sprig |
| salmon | 130 | a fillet |
| shallot | 40 |  |
| sweet potato | 200 |  |
| tenderstem broccoli | 15 | a spear |
| thyme | 3 | a sprig |
| walnut halves | 2 |  |

## 4. Packets - convert the data to grams instead of curating a size

**Changed direction after review.** The draft originally proposed a Unit Size per packet
ingredient. That produces the right shopping list, but it's the wrong place to solve it.

`packet` isn't a size, it's the *absence* of one. "1 packet coriander" never recorded
whether that was 30 g or 100 g - both exist on the shelf - so converting to grams doesn't
destroy a faithful record, it supplies something that was never captured. A Unit Size only
hides the same guess behind the aggregation.

The deciding argument is automatic ordering: from grams you can work out which pack size to
order, and you can still *choose* to display packets. From "1 packet" you can do neither
without re-guessing. Grams are the recoverable direction.

So: rewrite these `part` rows to grams, and don't set `packet` as a Display Unit - showing
"2 packet" when packets come in several sizes is confidently unhelpful.

**This is the one change here that touches production data and is hard to undo.** Take a
backup first, and note that 10 of these ingredients are used by a single recipe each and
never collide with another Unit, so converting them changes no shopping list - it only makes
the recipe read properly and keeps the catalog consistent for ordering later.

| Ingredient | Lines | Also used as | Proposed grams per packet |
| --- | --- | --- | --- |
| coriander | 1 | gram, pinch, tbsp, tsp | 30 |
| parsley | 2 | gram, pinch, tbsp, tsp | 30 |
| dill | 1 | pinch, tbsp, tsp | 30 |
| flat-leaf parsley | 1 | - (see follow-up #25, duplicate of parsley) | 30 |
| spinach | 2 | gram | 250 |
| green beans | 5 | (count) | 200 |
| tenderstem broccoli | 1 | (count), gram | 200 |
| asparagus | 1 | (count), gram | 250 |
| cherry tomato | 1 | (count), gram | 250 |
| prawns | 1 | (count), gram | 200 |
| pancetta | 1 | (count), gram | 130 |
| cashew nuts | 1 | gram | 200 |
| shiitake mushrooms | 1 | gram | 150 |
| lasagne sheets | 1 | (count), gram | 250 |
| baby corn | 1 | - | 175 |
| cooked rice | 2 | - | 250 |
| custard | 1 | - | 500 |
| extra firm smoked tofu | 1 | - | 200 |
| french fries | 1 | - | 750 |
| linguine | 1 | - | 500 |
| round gow gee wrappers | 2 | - | 270 |
| tortilla chips | 1 | - | 200 |
| tortilla dough | 1 | - | 500 |

Two quantities are `2` rather than `1` (cooked rice, gow gee wrappers) - those multiply.

`bottle` has the same problem for `salad dressing` (1 line, 250 ml proposed) and should be
converted the same way.

## 5. Densities (grams per millilitre)

36 ingredients. **One value each** - teaspoon, tablespoon and millilitre all
derive from it, so there's no way to set one and forget another.

| Ingredient | g per ml | 1 tbsp = | Note |
| --- | --- | --- | --- |
| basil | 0.2 | 3.0 g |  |
| black pepper | 0.5 | 7.5 g |  |
| breadcrumbs | 0.4 | 6.0 g |  |
| brown sugar | 0.8 | 12.0 g |  |
| butter | 0.95 | 14.2 g |  |
| caster sugar | 0.85 | 12.8 g |  |
| chilli flakes | 0.4 | 6.0 g |  |
| chilli powder | 0.5 | 7.5 g |  |
| chives | 0.2 | 3.0 g |  |
| coriander | 0.2 | 3.0 g | fresh, chopped |
| coriander seeds | 0.45 | 6.8 g |  |
| cornflour | 0.6 | 9.0 g |  |
| cumin seeds | 0.5 | 7.5 g |  |
| dill | 0.27 | 4.1 g |  |
| double cream | 1.0 | 15.0 g | base is millilitre, so this is the gram->ml direction |
| fennel seeds | 0.45 | 6.8 g |  |
| flour | 0.53 | 8.0 g |  |
| ginger & garlic paste | 1.1 | 16.5 g |  |
| gram flour | 0.55 | 8.2 g |  |
| grated parmesan | 0.4 | 6.0 g |  |
| ground cinnamon | 0.5 | 7.5 g |  |
| honey | 1.4 | 21.0 g |  |
| margarine | 0.95 | 14.2 g |  |
| mint | 0.27 | 4.1 g |  |
| nutmeg | 0.5 | 7.5 g |  |
| parmesan | 0.4 | 6.0 g | grated |
| parsley | 0.27 | 4.1 g | fresh, chopped |
| plain flour | 0.53 | 8.0 g |  |
| pomegranate seeds | 0.6 | 9.0 g |  |
| rosemary | 0.2 | 3.0 g |  |
| saffron | 0.2 | 3.0 g |  |
| salt | 1.2 | 18.0 g |  |
| sugar | 0.85 | 12.8 g |  |
| thyme | 0.2 | 3.0 g |  |
| tomato puree | 1.1 | 16.5 g |  |
| yoghurt | 1.03 | 15.5 g |  |

## 6. Display Units

What each ingredient's total is *shown* in. The base amount stays visible in brackets.

**Shown as a count:** apples, avocado, bacon rashers (smoked), cabbage, carrot, chicken breast, chicken thigh, chicken thighs (boneless), egg whites, garlic clove, mozzarella, new potato, onion, plum tomato, potato, radish, red onion, ripe medium tomato, ripe tomatoes, salmon, shallot, sweet potato

**Shown as tins:** butterbean, coconut cream, coconut milk, kidney beans

**Shown as packets:** *none* - see section 4. Packet sizes vary by product, so a packet count is a worse instruction than a weight until an ordering system knows what's actually on the shelf.

**Shown as bottles:** *none* - same reasoning as packets.

## 7. Agreed recipe fixes

Reviewed and decided. These are **recipe data corrections, not curation** - the stored line
doesn't say what the recipe means, and no Unit Size can fix that. Applying them removes five
ingredients from the curation set entirely, which is a better outcome than curating around
bad data.

**Nothing here has been applied.** These touch production recipe data.

| # | Recipe | Ingredient | Now | Should be |
| --- | --- | --- | --- | --- |
| 1 | 70 - Kung Pao Chicken | chicken stock | `1` (count) | `30` millilitre |
| 2 | 94 - Spicy Sausage Rice | white wine | `1` (count) | `100` millilitre |
| 3 | 720116 - Chicken Madras | worcestershire sauce | `4` (count) | `1` tablespoon |
| 4 | 89 - Porchetta w/ Salsa Verde | orange juice | `1` (count) | ingredient becomes **orange**, `1` (count) |
| 5 | 90141 - Salmon with harissa vegetable couscous | orange juice | `0.5` (count) | ingredient becomes **orange**, `0.5` (count) |
| 6 | 90139 - Courgette fritters and salsa verde | lemon | `0.25` millilitre | `0.25` (count) |
| 7 | 270116 - Chicken Pad See Ew | garlic clove | `1` tablespoon | `3` clove |
| 8 | 300120 - Creamy Sausage Pasta | garlic clove | `1` tablespoon | `3` clove |
| 9 | 330118 - Easy Roasted Garlic Butter Chicken | garlic clove | `1` tablespoon | `3` clove |
| 10 | 330116 - Slow-cooker Beef Stew | garlic clove | `1` tablespoon | `3` clove |
| 11 | 330119 - Juicy Beef Rissoles | garlic clove | `1` **teaspoon** | `1` clove - a teaspoon is ~1 clove, not 3 |
| 12 | 810116 - Pumpkin & Cauliflower Makhani | pumpkin | `1` (count) | `500` gram |

**`orange` does not exist as an ingredient** and needs creating for fixes 4 and 5.
`orange juice` keeps one legitimate line afterwards (`100` millilitre, Brisket Tacos).

### What these fixes remove from the curation

| Ingredient | After the fix | Curation needed |
| --- | --- | --- |
| lemon | all 17 lines are counts | **none** - no Unit Size, no Display Unit |
| white wine | all millilitre | **none** |
| worcestershire sauce | all tablespoon | **none** |
| pumpkin | all grams | **none** |
| orange juice | one line left | **none** |
| orange (new) | two count lines | **none** |
| chicken stock | still gram + millilitre + litre | base unit millilitre, plus a gram Unit Size (1.0) |
| garlic clove | still (count) + clove | count Unit Size 5, clove default 5 - both already proposed |

### Tinned pulses - decided

Use the **stated** tin weight, not drained. 400 g is how you buy them, so the `tin` default
of 400 stands and none of the six bean ingredients needs an override.

### How to apply

Two routes, and the safer one is probably not SQL:

- **Edit the twelve lines in the live app.** They go through the normal save path, which is
  transactional and validated, and `orange` gets created by the existing upsert with no
  special handling. Twelve lines across eleven recipes is maybe fifteen minutes.
- **SQL against production**, which is faster but hand-writes an ingredient insert and
  eleven part updates against live data, with a backup first.

Note `butter beans` and `butterbean` are separate ingredients - one for follow-up #25.
