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
Status: pending
Scope: Spec Phase 2, client side. `isAdmin` through `GET /user` and `hooks/use-user`; admin-only checkbox in `components/recipe-form/Form.tsx`; Featured made legible on the Recipe view.
Depends on: Session 2
Commit:
Notes:

## Session 4: The copy and its route
Status: pending
Scope: Spec Phase 4. `POST /recipe/featured/{slug}`, resolution by flag, loud error on ambiguous slug, copy with `featured_from` written in the insert's transaction, no-op when already taken.
Depends on: Session 2
Commit:
Notes: `RemoteURL` blanked and `featured` not copied — both are in the spec's traps list.

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
