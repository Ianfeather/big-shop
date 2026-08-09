---
spec: specs/cache-control-audit.md
status: in-progress
branch: implement/cache-control-audit
pr:
---

## Session 1: Safe default — `private, no-store` on every route
Status: done
Scope: negroni middleware in internal/pkg/app/app.go's GetRouter, first in the
stack; tests in app_test.go
Depends on: none
Commit: 5c2d4a1
Notes: gofmt/go vet/`go test ./...` green; no openapi.yaml drift (middleware
only). Verified against a live isolated stack (COMPOSE_PROJECT_NAME=bigshop-cc,
DB_PORT=3327 API_PORT=8087): /health, /recipes, /shopping-list, /tags, /units
and /ingredients all return `private, no-store`.

Standards + Spec review both flagged the same three things, all applied:
(1) the middleware sits *first* in the stack, not below the /health carve-out
as the spec originally said — kept the code's placement (nothing downstream of
the carve-out could give /health a policy) and amended the spec, since this
widens scope by one endpoint outside the audited 22; (2) the comments claimed
coverage of "a CORS rejection", a path rs/cors cannot produce with
AllowedOrigins `*` — claim removed; (3) only middleware-produced responses were
tested, never one Huma writes, which is precisely the mechanism Session 2's
overrides use — added a malformed-body case (Huma 400, no DB touched).
Also hoisted the duplicated `newRouter` helper to package scope and dropped two
inert table rows that 401'd before routing and so could not observe method or
path. The reviews' "no PR open yet" finding is step 5 of the run, not a defect.

## Session 2: The three unscoped routes
Status: done
Scope: Huma output header fields on app/tags.go, app/units.go (+ Netlify-Cache-Tag)
and app/ingredients.go; regenerate docs/openapi.yaml and types/api.d.ts
Depends on: Session 1 (its middleware is the default these override)
Commit: 8ab1c46 (+ review fixes, see below)
Notes: Verified live (COMPOSE_PROJECT_NAME=bigshop-cc, API_PORT=8087):
/tags `public, max-age=0, s-maxage=86400`; /units `public, max-age=0,
s-maxage=300` + `Netlify-Cache-Tag: units`; /ingredients `no-store`;
/recipes and /shopping-list still `private, no-store`. gofmt/vet/`go test
./...` green, openapi.yaml + types/api.d.ts regenerated and in sync.

**Count correction: there are 25 registered operations, not 22.** #44 was
written against 22 (nineteen account-scoped); three account-scoped routes have
been added since. Conclusions unchanged — the three unscoped routes are the
same three — but the numbers were corrected in the spec and in app.go.

Review fixes applied:
- The value test compared each constant to its own literal, so wiring
  `tagsCacheControl` into `UnitsOutput` would have passed — a day's TTL on the
  Open catalog, the one mistake here with no symptom until a purge is missed.
  Each output type now stamps its policy via a `withCachePolicy` method and the
  test goes through that. Mutation-checked: the swap fails the test.
- The route walk missed `Options`/`Head`/`Trace` on huma.PathItem, so a route
  registered with one of those could have declared `public` unseen. All eight
  methods now walked, header matching is case-insensitive (huma keys the map on
  the struct tag verbatim), and the magic `checked != 3` became a set
  comparison — which also closes the hole where a future `POST /units` would
  have been waved through by a path-keyed allowlist.
- Dropped two unearned comment claims: that the test covered any route added
  later (the expected set is still hand-kept), and a description of a
  request-issuing approach the test does not use.
Both reviews also flagged the state file being un-checkpointed, which is this
block, and the missing PR, which is step 5 of the run.

## Session 3: Purge `units` on write
Status: pending
Scope: new internal/pkg/purge package (async, best-effort, coalescing, no-op when
unconfigured), wired into addRecipe/editRecipe; ADR; env-var docs; follow-ups.md
bookkeeping (#44 resolved, new item for the in-process /ingredients cache)
Depends on: Session 2 (nothing to purge until /units carries a cache tag)
Commit:
Notes:
