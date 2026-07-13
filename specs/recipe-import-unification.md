# Unify Recipe Import extraction behind one module

## Current state (why this isn't greenfield)

Big Shop has three Import Sources for populating a new Recipe — URL Import, Photo Import, Manual Entry's bulk-paste — and they've drifted into two independent, unequal implementations:

- **URL Import** (`pages/api/parse-recipe-url.js`) and **Manual bulk-paste** (`pages/api/parse-recipe-text.js`) both call `lib/extract-recipe-ingredients.js`, which receives `knownIngredients`/`knownUnits` and does catalog-aware naming/unit standardization via `openai.responses.create` with a strict `json_schema`, against the shared `EXTRACTION_MODEL` constant. URL Import also calls `lib/extract-recipe-method.js` in parallel for the method.
- **Photo Import** (`pages/api/recipe-image.mjs`) hand-rolls its own prompt and schema, on `openai.chat.completions.create` with `gpt-4-vision-preview`, `response_format: json_object` (no schema enforcement). It never receives `knownIngredients`/`knownUnits` — the handler signature doesn't even accept them from the client — so it structurally cannot reconcile extracted ingredients against the Global Catalog. Its pantry-staple rule is a single unexplained sentence ("omit salt, pepper, oil, or water") versus the 20-line quantity-threshold rule the shared prompt uses. It has no `isVegetarian` field at all, so photo-imported recipes can never get the auto-applied "Vegetarian" Tag that URL Import gets.
- Client-side, `components/recipe-form/Form.js`'s `matchCanonicalIngredient` (a deterministic case-insensitive exact-match safety net on top of the LLM's own reuse instruction) is only wired up for the bulk-paste path (`appendIngredients`). Ingredients arriving via `initialRecipe` — which is how **both** URL Import and Photo Import feed `Form.js`, routed through `pages/recipes/new.js` — skip this safety net entirely.

Net effect: Photo Import silently pollutes the Global Catalog (e.g. "olive oil" from a photo vs. "Olive Oil" typed elsewhere become two different Ingredient rows), which breaks the exact thing the Global Catalog exists for — see [ADR-0001](../docs/adr/0001-global-ingredient-catalog.md) — clean cross-recipe shopping-list aggregation.

`components/recipe-form/Form.js` is the single hottest file in the repo (27 of the last 100 commits touch it), largely because this seam was never cut cleanly.

## Proposed approach

### Phase 1 — Shared extraction core

Add `lib/recipe-import/extract.js`:

```
extractRecipe({ input, knownIngredients = [], knownUnits = [] })
  -> { name, ingredients, method, tags }
```

- One prompt, one strict `json_schema` covering `name`, `isVegetarian`, `ingredients`, `method` in a single model call (merging what `extract-recipe-ingredients.js` and `extract-recipe-method.js` currently do as two calls) — including for image input. A vision call is the most expensive/slowest part of Photo Import; doubling it for a separate method call isn't worth the schema symmetry.
- Uses `EXTRACTION_MODEL` directly for every adapter, including image input — **assumption to verify before this phase lands**: this constant must point at a multimodal-capable model via `responses.create`. If it doesn't, this phase needs a second model constant (e.g. `VISION_EXTRACTION_MODEL`) passed alongside `EXTRACTION_MODEL`, same API shape, same prompt-building logic — only the model id would vary by adapter.
- After the model call returns, applies `matchCanonicalIngredient` (moved here from `Form.js`) to every returned ingredient name before returning. This is the key structural fix: the interface's postcondition becomes "returned names are already snapped to known ingredients where possible" — no caller can forget to wire this in, which is exactly how the current gap happened.
- Maps `isVegetarian` internally to `tags: ['Vegetarian'] | []` before returning. Callers never see raw `isVegetarian`.
- Carries over the full existing prompt rules from `extract-recipe-ingredients.js` (pantry-staple quantity thresholds, ingredient naming/word-order rules, quantity range midpoints, unit standardization/metric preference) as the *only* prompt — Photo Import's cruder inline rules are deleted, not merged.

### Phase 2 — Input adapters

Add one file per Import Source, each converting its raw input into whatever shape `extract.js`'s `input` expects:

- `lib/recipe-import/url.js` — `htmlToInput(html)`, reusing the existing HTML-stripping logic (`NOISE_SELECTOR`, `MAX_HTML_LENGTH` truncation) currently inline in `parse-recipe-url.js`.
- `lib/recipe-import/photo.js` — `imageToInput(base64)`, building the multimodal content block (text instruction + image) that `responses.create` expects for image input.
- `lib/recipe-import/paste.js` — `textToInput(raw)`, effectively a passthrough.

None of these touch the async Processing Job lifecycle — that stays a route-level concern (see Phase 3).

### Phase 3 — Rewire the three routes to thin wrappers

- `pages/api/parse-recipe-url.js` — fetch + strip HTML (unchanged), call `extract.js` via `url.js`'s adapter, return its result directly. No more separate `ingredientsResult`/`methodResult` merge.
- `pages/api/recipe-image.mjs` — **keeps its existing Job/Blobs/polling wrapper untouched** (that's a Lambda-timeout concern, unrelated to extraction). Only `processImage` changes: it now calls `extract.js` via `photo.js`'s adapter instead of its own `chat.completions.create` call. This drops `gpt-4-vision-preview`, the hardcoded unit list, and the one-line pantry rule entirely.
- `pages/api/parse-recipe-text.js` — calls `extract.js` via `paste.js`'s adapter. Bulk-paste callers on the client only use the `ingredients` field of the result and ignore `name`/`method`/`tags` — that's already how `Form.js`'s `appendIngredients` works today, no change needed there.

### Phase 4 — Simplify the client call sites

- `components/recipe-form/Form.js`: delete `matchCanonicalIngredient` (moved to `extract.js` in Phase 1). `appendIngredients` and the `initialRecipe` `useEffect` both become plain merges — everything arriving is already reconciled server-side.
- `pages/recipes/new.js`: both `fetchFromUrl` and the job-polling `useEffect` read `tags` directly off the `extract.js` result instead of deriving it from `isVegetarian` (which no longer exists in the response shape).

## Decisions made (grilled — do not re-litigate without a load-bearing reason)

- **Scope**: extraction unification and client-side reconciliation centralization ship together, not as separable increments — they share the same seam.
- **Model/API**: Photo Import migrates fully onto `responses.create` + strict `json_schema` + `EXTRACTION_MODEL`. No separate legacy path preserved.
- **Call shape**: always one combined model call per source (name + isVegetarian + ingredients + method), never split into ingredients/method calls — including for Photo, despite that meaning URL Import's current two-call shape also collapses to one.
- **Job lifecycle**: stays entirely outside `extract.js`. It is a plain `Promise`-returning function for every adapter; only the Photo route wraps a call to it in the existing Job/polling pattern.
- **Reconciliation seam**: `matchCanonicalIngredient` moves inside `extract.js` (server-side), not left client-side "applied more consistently."
- **Tag mapping**: `extract.js` returns `tags` directly; `isVegetarian` never appears in its output.
- **Module layout**: `lib/recipe-import/{extract,url,photo,paste}.js`, named after the Import Source domain concept (see `CONTEXT.md`).
- **Testing**: no new test runner/eval infrastructure as part of this change. This repo has no JS unit test framework (no jest/vitest/mocha) — introducing one was explicitly deferred, and correctness here remains the same LLM-eval territory `evals/` already covers for Dave, not taken on in this pass.

## Explicitly out of scope

- Broader decomposition of `Form.js`/`new.js` (e.g. an `Import Source` resolution module owning tab-switching) — a separate, larger finding from the same architecture review, not part of this change.
- Any new JS test runner or `evals/` coverage for recipe extraction.
- Batch/perf work unrelated to this seam.

## Things to get right when building this

- **Verify `EXTRACTION_MODEL` is multimodal** before writing `photo.js` — this is the one unverified assumption in this spec (see Phase 1). If it isn't, fall back to a second model constant, not a second API shape.
- Photo Import's `DEFAULT_UNITS` fallback list must still apply when `knownUnits` is empty (e.g. a brand-new account with no units yet) — same fallback `extract-recipe-ingredients.js` already has.
- The multimodal prompt builder in `extract.js` needs to construct a content-block array for image input rather than the plain string interpolation the current text-only `buildPrompt` uses — these are genuinely different request shapes, not just a parameter swap.
- `recipe-image.mjs`'s existing image validation/resize/form-parsing (`formidable`, `validateImage`, 5MB limit) are route-specific mechanics, unrelated to extraction — leave them in the route.
