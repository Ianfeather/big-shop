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

35 ingredients - the largest category, and your most-used ones.

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
| lemon | 100 | the fruit; its millilitre lines are juice - see flags |
| mint | 5 | a sprig |
| mozzarella | 125 | a ball |
| new potato | 50 |  |
| onion | 150 |  |
| plum tomato | 70 |  |
| potato | 180 |  |
| pumpkin | 1200 | a whole one - wide variance, check |
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

**Shown as a count:** apples, avocado, bacon rashers (smoked), cabbage, carrot, chicken breast, chicken thigh, chicken thighs (boneless), egg whites, garlic clove, lemon, mozzarella, new potato, onion, plum tomato, potato, pumpkin, radish, red onion, ripe medium tomato, ripe tomatoes, salmon, shallot, sweet potato

**Shown as tins:** butterbean, coconut cream, coconut milk, kidney beans

**Shown as packets:** *none* - see section 4. Packet sizes vary by product, so a packet count is a worse instruction than a weight until an ordering system knows what's actually on the shelf.

**Shown as bottles:** *none* - same reasoning as packets.

## 7. Flagged - please check these

Some collisions are **data-entry errors rather than real unit variety**. Adding a Unit Size
would legitimise the mistake and silently produce a wrong number, so these are deliberately
left unconverted - they'll keep showing as separate Amounts.

| Ingredient | Issue | What I did |
| --- | --- | --- |
| chicken stock | 1 line uses a bare count | A count of stock is almost certainly a stock *cube* or *pot* entered without a unit. No Unit Size proposed - fix the recipe instead, or the count silently becomes a weight. |
| worcestershire sauce | 1 line uses a bare count | Probably meant a bottle, or a tablespoon. Left unconverted. |
| white wine | 1 line uses a bare count | Probably a bottle. Left unconverted. |
| orange juice | 1 line uses a bare count | Probably a carton. Left unconverted. |
| lemon | 16 counts vs 1 millilitre | The millilitre line is juice, not fruit. Base unit stays gram with a count Display Unit, and no millilitre Unit Size, so juice stays a separate Amount rather than being counted as lemons. |
| garlic clove | 4 lines use tablespoon, 1 uses teaspoon | Almost certainly garlic paste or minced garlic, not cloves. **No density proposed**, so these stay a separate Amount: a list reads "3 + 1 tablespoon" rather than silently folding paste into a clove count. Check those five recipes - if they do mean paste, they want their own ingredient. |
| pumpkin | whole-pumpkin weight varies hugely | 1.2kg proposed; adjust if your recipes mean a small one. |
| kidney beans / butterbean | tin size is drained vs undrained | 400g proposed (undrained, the tin's stated weight). Drained is ~240g. If your recipes mean drained, these are ~40% over. |
