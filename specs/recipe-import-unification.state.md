---
spec: specs/recipe-import-unification.md
status: in-progress
branch: implement/recipe-import-unification
pr:
---

## Session 1: Shared extraction core (extract.js)
Status: done
Scope: lib/recipe-import/extract.js — extractRecipe({input, knownIngredients, knownUnits}) -> {name, ingredients, method, tags}. One prompt/schema merging extract-recipe-ingredients.js + extract-recipe-method.js, server-side matchCanonicalIngredient reconciliation, isVegetarian->tags mapping, EXTRACTION_MODEL used directly.
Depends on: none
Commit: 478a924
Notes: Test gate: eslint clean, esbuild syntax check clean; no runtime
surface to exercise yet (nothing calls this module until Session 3), so the
verify skill wasn't applicable this session per its own scoping (no diff to
observable behavior) - full end-to-end verify deferred to Session 3.
Review gate: Standards + Spec sub-agents both ran. Spec review flagged the
EXTRACTION_MODEL-multimodal item as looking unresolved - this was a spec
wording bug, not a code bug: the user already confirmed this exact choice
during grilling ("use it directly"). Fixed by correcting the spec's Phase 1
/ "Things to get right" wording in this same commit rather than re-asking an
already-answered question. Standards review flagged (a) the 'Vegetarian'
tag-name string now living in two places (extract.js and
components/tag-pill/tag-meta.js) - judgement call, deferred: this is the
same total duplication that existed before (new.js's ternary + tag-meta.js),
just relocated, and resolves back to today's count once Session 4 removes
new.js's copy; introducing a shared tag-name constant is out of scope for
this spec. (b) extract-recipe-ingredients.js/extract-recipe-method.js prompt
text being duplicated in extract.js - expected for this session, queued for
resolution in Session 3 by deleting those two now-superseded files once
nothing calls them.

## Session 2: Input adapters
Status: done
Scope: lib/recipe-import/url.js (htmlToInput), lib/recipe-import/photo.js (imageToInput), lib/recipe-import/paste.js (textToInput)
Depends on: Session 1
Commit: 34294ba
Notes: Test gate: eslint clean; no runtime surface yet (Session 3 wires
these in), verify skill deferred to Session 3 for the same reason as
Session 1. Review gate clean - url.js confirmed byte-for-byte faithful to
parse-recipe-url.js's existing HTML-stripping logic; photo.js/paste.js
correct passthroughs. One noted transient duplication (url.js's
NOISE_SELECTOR/MAX_HTML_LENGTH copied from the route it'll replace) -
resolves in Session 3, no action needed now.

## Session 3: Rewire the three routes to thin wrappers
Status: pending
Scope: pages/api/parse-recipe-url.js, pages/api/recipe-image.mjs (processImage only, Job wrapper untouched), pages/api/parse-recipe-text.js — all call extract.js via their adapter
Depends on: Session 2
Commit:
Notes:

## Session 4: Simplify client call sites
Status: pending
Scope: components/recipe-form/Form.js (delete matchCanonicalIngredient, plain merges), pages/recipes/new.js (read tags directly from result)
Depends on: Session 3
Commit:
Notes:
