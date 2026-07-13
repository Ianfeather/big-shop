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
Status: done
Scope: pages/api/parse-recipe-url.js, pages/api/recipe-image.mjs (processImage only, Job wrapper untouched, plus threading knownIngredients/knownUnits through from multipart fields), pages/api/parse-recipe-text.js — all call extract.js via their adapter. Deleted the two now-superseded lib files.
Depends on: Session 2
Commit: 306a3f8
Notes: Test gate: eslint clean, npm run build clean. Real end-to-end verify
(not mocked) - live npm run dev, OPENAI_API_KEY present in .env.local:
parse-recipe-text and parse-recipe-url both exercised against real content
(url via a local test HTTP server, since real-world sites truncate past
MAX_HTML_LENGTH before reaching ingredients - pre-existing, not a
regression, confirmed by testing the unchanged logic in isolation).
Ingredient reconciliation, pantry-staple omission, unicode fractions,
dual-unit metric preference all confirmed correct. Image branch verified
directly (extractRecipe + imageToInput with a real generated image),
bypassing the Job wrapper since Netlify Blobs isn't configured locally -
confirms EXTRACTION_MODEL is multimodal and photo gets full catalog
reconciliation parity with text.
Review gate: 2 real gaps found, both folded into Session 4 (already touches
new.js): (1) processImage now returns an object not a JSON string, so
new.js's job-polling JSON.parse(job.result) will throw - not spelled out in
the spec's Phase 4 bullets, added to Session 4 scope. (2) photo upload's
FormData doesn't send knownIngredients/knownUnits yet, so this session's
server-side threading is inert until Session 4 sends them. The isVegetarian
-> tags mismatch in new.js the reviewer also flagged is the deliberate,
spec-anticipated interim state (Phase 4 already covers it), not a gap.

## Session 4: Simplify client call sites
Status: done
Scope: components/recipe-form/Form.js (delete matchCanonicalIngredient, plain merges). pages/recipes/new.js: (a) fetchFromUrl reads tags directly from result instead of deriving from isVegetarian; (b) job-polling effect reads job.result directly (no second JSON.parse - it's already an object), and drops the now-dead try/catch around it; (c) handleImageChange sends knownIngredients/knownUnits in the photo-upload FormData, closing the gap Session 3 left inert.
Depends on: Session 3
Commit: 4741b87
Notes: Test gate: eslint clean. Real end-to-end verify via a live browser
(Playwright) against npm run dev:full (real DB + Go API + real model calls,
not mocked): URL Import confirmed correctly checking/unchecking the
Vegetarian tag for a vegetarian vs. non-vegetarian test recipe (screenshot
at specs/evidence/recipe-import-unification/url-import-vegetarian-tag.png),
pantry-staple omission and unit resolution against the real DB-backed
catalog both correct, bulk-paste ingredient entry still works correctly
with matchCanonicalIngredient removed client-side (server-side
reconciliation in extract.js covers it).
Review gate clean - Standards: 0 hard violations, a few judgement calls (one
fixed: removed the now-dead try/catch with a stale "corrupted" error message
around the job.result destructure, since a strict-schema object can't fail
to destructure). Spec: 0 findings, all Phase 4 items plus both
Session-3-necessitated fixes confirmed present and correct.

Discovered but explicitly NOT fixed (outside both specs' scope - no code
in this implementation run touches the Go backend, schema, or SQL):
submitRecipe's POST /recipe 500s whenever an ingredient has no unit (e.g.
"3 eggs") or, eventually, any unit at all once duplicates accumulate. Root
cause: the `unit` table has no unique constraint on `name`
(netlify-functions/recipes/internal/pkg/service/recipe.go's insertUnits
upsert never dedupes as a result), so insertParts'
`(SELECT id FROM unit WHERE name = ?)` subquery throws "Subquery returns
more than 1 row" once 2+ rows share a name - confirmed reproducible in a
fresh dev:full seed within a handful of saves. Compounded by AddRecipe
having no transaction (recipe-writes-and-shopping-list-generation-seam.md's
Phase 2 target): every failed save leaves an orphaned recipe row and
duplicate ingredient/unit rows behind, making the next save likelier to
fail too. Recommend a follow-up spec: unique constraint + dedup migration
on unit.name (mirroring the prior ingredient_department fix), independent
of and in addition to the Phase 2 transaction work already planned.
