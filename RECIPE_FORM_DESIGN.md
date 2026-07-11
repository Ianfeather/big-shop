# Recipe Form: Ingredient Entry — Critique & Design Choices

## Context

Explored on `recipe-form` branch, running `npm run dev` with `NEXT_PUBLIC_USE_MOCKS=true`,
against `components/recipe-form/Form.js`. Tested both entry paths:

1. Auto-fill from a remote URL (`https://www.bbc.co.uk/food/recipes/turkish_spiced_chicken_12732`),
   via `pages/api/get-ingredients.js`.
2. Fully manual entry with no URL.

## What's actually wrong

### 1. The regex scraper fails on roughly half of any real recipe, silently

`pages/api/get-ingredients.js` uses one regex
(`/(?<quantity>[\d|\/]+)(?:\s)?(?:(?<unit>[a-zA-Z\.]{1,5})?) (?<ingredient>[\p{L}\p{M}\-| ]+)/u`)
to turn every scraped `<li>` into `{name, quantity, unit}`, for every recipe site. Real recipe
text breaks it constantly:

- Unicode fraction glyphs (`½ tsp ground cinnamon`, `¾ tsp cayenne pepper`) don't match `[\d|\/]+`
  at all, so `quantity`/`ingredient` come back `undefined`.
- Dual-unit notation (`200g/7oz plain flour`, `200ml/7fl oz Greek yoghurt`) — extremely common on
  BBC/BBC-Good-Food-style recipes — mangles both fields: quantity becomes `"/7"`, name becomes
  `"oz Greek yoghurt"`.
- Descriptive lead words get captured as the unit: `1 green chilli, ...` parses `unit: "green"`,
  which then fails to match any real unit and gets treated as garbage.
- Non-numeric quantities (`good squeeze of lemon juice`, `handful of baby leaves`, `sea salt
  flakes`) never had a chance.

On the BBC turkish-chicken recipe (27 lines), **14 of 27 ingredients** — over half — failed to
parse into anything usable.

### 2. Failure mode for #1 is "read raw HTML text and retype it yourself"

`Form.js` partitions extraction results into `matched` (pre-filled rows) and `unmatched`. Unmatched
items are dumped as a bulleted list of raw scraped strings — `70g/2½oz pitted green olives, roughly
chopped` — inside a warning box, with the instruction "you should add manually to avoid mistakes."
The user must now visually re-parse each line themselves and retype it through the single-ingredient
add flow below. For a recipe where half the lines fail, auto-fill saves less time than it costs:
the user reads a wall of scraped text, mentally extracts quantity/unit/name, then does full manual
entry anyway — while also having to double check the "matched" rows, several of which are subtly
wrong (see #4).

### 3. Manual add is one ingredient at a time, and each one is 3+ separate interactions

To add a single ingredient: type into the autosuggest box → select/confirm → click "Add" (or hit
Enter) → **then** click into the newly-appended row's Quantity field → type a number → click the
Unit `<select>` → choose a unit. That's 5-6 discrete interactions per ingredient, with no way to
enter quantity/unit at the same time as the name. A 20-ingredient recipe is 100+ interactions.
There is no bulk/paste path at all — the only way to get ingredients in is one at a time through
this flow, whether or not a source recipe text is available to copy from.

### 4. No enforcement against the canonical ingredient list → duplicate ingredients

The autosuggest is decorative, not enforced: typing free text and hitting Enter adds it verbatim
even when a canonical match exists. Reproduced directly: typed `sea salt`, hit Enter, got a new
ingredient row for "Sea Salt" — despite the mock ingredient list already containing a canonical
`salt`. This is the exact issue flagged in a `// Issues:` comment at the top of `Form.js` ("Ingredients
won't match and we get loads of similar ones — need to prune the list"). It also affects the
regex-extracted rows: `1 green chilli` and `green chilli` (the canonical name) never get reconciled
either, because the extractor doesn't cross-check its output against the ingredient list at all.
Every near-duplicate here breaks shopping-list aggregation, which depends on ingredient identity.

### Minor friction, worth fixing regardless of which option below is picked

- New rows are appended to the bottom of a growing list with no scroll-to and no retained focus —
  after every single add the user has to relocate both their scroll position and the input.
- The unit `<select>` silently shows blank when `ingredient.unit` doesn't match any option
  value (e.g. extracted `unit: "green"`), giving no visual signal that a required-ish field is
  actually empty/wrong.
- Reaching the ingredients section at all requires filling in the top form and clicking "Next:
  Add Ingredients" even for a from-scratch manual recipe with no URL — an extra gate for the
  simplest path.

## Root cause

The scraper tries to solve unbounded natural-language parsing with one hand-rolled regex, and the
form's only fallback when that regex fails is "make the human do it, one field at a time, with no
bulk input." Two structurally different problems are being asked of the same weak tool: (a) turning
free-text ingredient lines into `{name, quantity, unit}`, and (b) reconciling names against a
canonical list. Neither manual entry nor the regex path solves either problem well.

## Options considered

**A. Smart quick-add (shorthand parsing on the existing single-line input)**
Let the existing "Add ingredient" field accept a full shorthand line (e.g. `2 tbsp olive oil`) and
parse it client-side into `{name, quantity, unit}` in one step, instead of requiring three separate
fields/interactions. Enter re-focuses the input immediately for rapid consecutive entry. Falls back
to today's plain-name behavior if the line doesn't parse. Lowest effort, no backend change, doesn't
touch the URL-extraction path at all — only helps the fully-manual case.

**B. Bulk paste + local parse**
A textarea where the user pastes/types a full multi-line ingredient list at once (from a cookbook,
a site, or memory) and a "Parse" step runs the same shorthand parser per-line, rendering the whole
batch as pre-filled, immediately-editable rows. Unifies "auto-extract found half of them" and
"type the rest manually" into one flow: paste everything (including the scraper's own unmatched
output) and fix only the rows that parsed wrong, in place, rather than retyping from scratch.
Medium effort, fully client-side, reuses/extracts the existing regex logic.

**C. AI-assisted structured parse**
Same paste-a-list UI as B, but sends the raw lines to a new API route backed by the OpenAI setup
already used for photo extraction (`pages/api/recipe-image.mjs`) and Dave. The prompt supplies the
canonical ingredient and unit lists so the model snaps names/units to existing entries instead of
minting near-duplicates, and it isn't defeated by fractions, dual-unit notation, or "handful of"
style quantities the way the regex is. Highest quality, highest cost (API latency + tokens),
depends on `OPENAI_API_KEY`.

None of these individually fix problem #4 for the fully-freehand case (typing a brand new
one-off name will always be legitimate sometimes) — B and C both reduce it a lot by making the
"paste everything, review once" flow the default, and C actively snaps to canonical names.

## What was built to compare

All three were implemented as switchable modes inside the same ingredients step of `Form.js`, so
the three approaches can be compared side-by-side in one running form:

- **Quick add** (Option A) — the default/first tab, shorthand single-line parsing.
- **Paste list** (Option B) — bulk textarea, local regex/heuristic parsing.
- **AI parse** (Option C) — bulk textarea, sent to a new `/api/parse-ingredients` route.

The existing per-row table (name/quantity/unit/delete) is unchanged and still how any row — however
it was created — gets corrected, since some manual correction will always be needed.

## Comparison, using the same failure cases from the BBC recipe

Re-ran the exact lines that broke the original regex scraper through each new mode:

| Input line | Old regex scraper | Paste list (B, local) | AI parse (C) |
|---|---|---|---|
| `2 tbsp olive oil` | ✅ works | ✅ works | ✅ works |
| `½ tsp ground cinnamon` | ❌ dumped as raw text | ❌ still no quantity match (no unicode fraction support) | ✅ `0.5 teaspoon` |
| `1 green chilli, halved, seeds removed, roughly chopped` | ❌ unit becomes `"green"`, treated as unmatched | ⚠️ row added, but name is `"chilli"` (loses "green") and unit is blank | ✅ name snapped to canonical `green chilli`, prep notes stripped |
| `200g/7oz plain flour` | ❌ quantity `"/7"`, name mangled | ⚠️ row added but same garbled quantity/name, needs manual fix | ✅ `200 gram` |
| `200ml/7fl oz Greek yoghurt` | ❌ same dual-unit failure | ⚠️ same, needs manual fix | ✅ `200 millilitre` |
| `salt and freshly ground black pepper` | ❌ dumped as raw text | ❌ added as one unsplit ingredient | ✅ split into `salt` + `freshly ground black pepper` |

Paste list (B) is still a real improvement over today — every line becomes an editable row in one
action instead of a page of text to manually re-enter — but it inherits the regex's blind spots
for fractions and dual-unit notation, so several rows still need a manual fix. AI parse (C) handled
every case correctly in testing, including snapping `green chilli` to the existing canonical
ingredient rather than creating a duplicate, at the cost of a network round-trip (a few seconds) and
OpenAI API usage per parse.

## Outcome

Decision, recorded in `specs/recipe-design.md`: go all-in on option C. The regex/DOM-selector
scraper (`pages/api/third-parties/*`, `pages/api/get-ingredients.js`) is removed entirely and
replaced with an LLM-based pipeline (`pages/api/parse-recipe-url.js`, using
`lib/extract-recipe-ingredients.js` and `lib/extract-recipe-method.js`, model `gpt-5.6-terra` via
the OpenAI Responses API with structured outputs) that also extracts the recipe name, method, and a
vegetarian tag - and the manual/paste path (`pages/api/parse-recipe-text.js`) uses the same
ingredients extractor. `pages/recipes/new.js` was reworked to a Recipe Link / Import from Camera /
Enter Manually tab layout with immediate, no-second-page fetching, and `Form.js` to the two-column
Name+Link / Tags / Ingredients / Method+Notes layout. See `specs/recipe-design.md` for the full
brief.
