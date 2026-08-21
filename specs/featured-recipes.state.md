---
spec: specs/featured-recipes.md
status: in-progress
branch: implement/featured-recipes
pr:
---

## Session 1: Schema, seed, and the shape on the wire
Status: done (review gate outstanding)
Scope: Spec Phase 1. `migrations/042_featured_recipes.sql` (`user.is_admin`, `recipe.featured` + index, `recipe.featured_from` self-FK `ON DELETE SET NULL`), `docker/mysql-seed/dev-seed.sql`, `IsAdmin` on `common.User`, `Featured` on `common.Recipe`, regenerated `docs/openapi.yaml` and `types/api.d.ts`.
Depends on: none
Commit: 58adc61
Notes: `Featured` is a `*bool` rather than a `bool` — a deliberate refinement of the spec, so "changed" is well defined and a client that omits the field cannot silently unflag. Both OpenAPI drift checks run in `ci.yml`'s `go` job.

Test gate GREEN: `go build`/`gofmt -l`/`go vet` clean, `go test ./... -race` all packages ok, `npm run typecheck`/`lint` clean, vitest 370/370. Verified against a fresh MySQL 8 volume (`COMPOSE_PROJECT_NAME=bigshop-impl5 DB_PORT=3390 API_PORT=8390` — this is a non-primary worktree, so bare `docker compose` would hit another worktree's stack): migration replays with `_migration_status.ok = 1`, both columns/constraint/index present, seed correct.

**Open question 1 is answered for MySQL 8**: the self-referencing FK applies, and `ON DELETE SET NULL` behaves as designed — deleting the source Recipe (after its `part` rows, which `part.recipe_id` RESTRICTs) leaves the copy intact with `featured_from` NULL. TiDB is still unverified; 041 established FK support there but not a self-reference.

REVIEW GATE OUTSTANDING — both code-review agents terminated on a session limit without reporting. Re-run `/code-review` against `fbf95b2` before treating Session 1 as closed; the work is committed as 58adc61 either way.

## Session 2: The admin gate (backend)
Status: done
Scope: Spec Phase 2, server side. `Caller.IsAdmin()` lazily resolved and memoised like `AccountID()`; `AddRecipe`/`EditRecipe` honour `Featured` with 403 when the value changes and the caller is not an admin.
Depends on: Session 1
Commit: (see git log)
Notes: The rule lives in one pure function, `service.resolveFeatured(submitted, stored, caller)`, so it is testable without a database and there is one place to read it. `service.ErrNotAdmin` is the sentinel; `app/recipe.go` maps it to 403 on both write paths.

`EditRecipe` reads `featured` in the ownership check it already runs, so the rule costs no extra round trip. Resolution happens *before* `BeginTx` in both paths — a refusal should not have opened a transaction.

`NewCaller` now takes a second resolver; the four existing `caller_test.go` call sites pass a `noAdmin` helper, and two new tests pin that `IsAdmin()` is lazy and memoises both its value and its error.

Test gate GREEN: `gofmt`/`vet` clean, `go test ./... -race` all packages ok, OpenAPI in sync. `TestResolveFeatured` covers all ten cases including the two that must never 403 and the "no lookup when unchanged" case that keeps the query off every ordinary save.

REVIEW GATE OUTSTANDING for the same reason as Session 1 — re-run `/code-review` against `fbf95b2`.

## Session 3: The admin UI
Status: done
Scope: Spec Phase 2, client side. `isAdmin` through `GET /user` and `hooks/use-user`; admin-only checkbox in `components/recipe-form/Form.tsx`; Featured made legible on the Recipe view.
Depends on: Session 2
Commit: (see git log)
Notes: The Featured note on the Recipe is shown to anyone who can see the Recipe rather than gated on admin — only an admin's own Account holds one, and ADR-0011 accepts that ordinary edits there change what new users receive, so the curator has to see it without opening the edit form.

`FormRecipe.featured` is optional and the form omits it entirely for a non-admin, which is what stops an ordinary save being read as an un-publish and 403'd. There is a test for exactly that.

Two test-authoring notes worth keeping: the save button reads "Update Recipe" in edit mode, and `Form.test.tsx`'s `beforeEach` does not clear `apiPut`, so assertions must use `mock.lastCall` — `calls[0]` silently belongs to whichever test ran first, and one of these tests passed spuriously until that was fixed.

Test gate GREEN: vitest 378/378 (up from 370), typecheck and lint clean.

## Session 4: The copy and its route
Status: done
Scope: Spec Phase 4. `POST /recipe/featured/{slug}`, resolution by flag, loud error on ambiguous slug, copy with `featured_from` written in the insert's transaction, no-op when already taken.
Depends on: Session 2
Commit: (see git log)
Notes: `AddRecipe`'s body was extracted into `insertRecipeTx(ctx, tx, recipe, accountID, featured, featuredFrom)` so a create and a copy are literally the same write, differing in the two values that actually differ. That is what puts `featured_from` in the same statement as the row — the spec's trap — rather than in an update after it.

`GetFeaturedRecipeBySlug` resolves `WHERE slug = ? AND featured = 1` with **no account scoping**, which is the one read in the file that does not scope, and the thing most likely to be "corrected" by someone matching the surrounding code. The dev seed's second Account is what makes that mistake fail rather than pass.

An unpublished slug is 404, not 403: a Recipe that was never Featured and one that never existed are the same answer here, and drift between the template's slugs and the flag is expected rather than exceptional.

Verified against the running API and a real database, not just compiled: copying returns `alreadyHad: false` then `true` for the same id; an unknown slug 404s; and `veggie-chilli` — which exists **in the caller's own Account** but is not Featured — also 404s, which is what proves resolution is by the flag rather than the identifier. The copied row lands in account 1 from a source in account 2 with `featured = 0`, `featured_from = 3`, blank `remote_url`, all five Ingredient Lines and its Tag.

Unit tests pin the two silent-failure traps on the INSERT's *arguments* rather than its SQL text. There is no query-mocking infrastructure in this repo (no sqlmock), so the lookup and idempotency paths are covered by the manual run above and by Session 6's e2e rather than by Go unit tests.

Test gate GREEN: `go test ./... -race` all packages, gofmt/vet clean, OpenAPI + api.d.ts regenerated, vitest 378/378, typecheck and lint clean.

## Session 5: Return-to through Auth0
Status: pending
Scope: Spec Phase 3. `pages/_app.tsx` gate records the attempted path, `hooks/use-login.ts` passes `appState: { returnTo }`, callback honours it, relative-path-only validation.
Depends on: none (ordered here so Session 6 can use it)
Commit:
Notes: Not e2e-testable — `NEXT_PUBLIC_DISABLE_AUTH` makes `useAuth` report `isAuthenticated: true` unconditionally, so the gate never fires under e2e. Unit tests incl. open-redirect cases; full round trip verified by hand.

## Session 6: The landing page and the count
Status: pending
Scope: Spec Phases 5 and 7. `pages/recipes/add/[slug].tsx` with its three states, `page-titles.ts` entry, `'featured'` added to `RecipeSource` and fired on success, `e2e/featured-recipe.spec.ts`. Also corrects the spec's Testing section per Session 5's note.
Depends on: Sessions 4, 5
Commit:
Notes: The e2e spec must not touch the Shopping List, so it can run alongside `shopping-list.spec.ts`.

## Session 7: The email
Status: pending
Scope: Spec Phase 6. `templates/recipes.html` linking each dish at `/recipes/add/<slug>`, regenerated `testdata/recipes.golden.html`, curation runbook section in `docs/email-testing-runbook.md`.
Depends on: Session 6
Commit:
Notes: Carries a hand-off — creating the three real Featured Recipes is content work in the production database (production access plus a human-written method per ADR-0011). Template is written against the slugs the current dish names produce; `ONBOARDING_EMAIL_ENABLED` is off, so nothing breaks in the interim.
