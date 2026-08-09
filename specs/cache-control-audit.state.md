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
Status: pending
Scope: Huma output header fields on app/tags.go, app/units.go (+ Netlify-Cache-Tag)
and app/ingredients.go; regenerate docs/openapi.yaml and types/api.d.ts
Depends on: Session 1 (its middleware is the default these override)
Commit:
Notes:

## Session 3: Purge `units` on write
Status: pending
Scope: new internal/pkg/purge package (async, best-effort, coalescing, no-op when
unconfigured), wired into addRecipe/editRecipe; ADR; env-var docs; follow-ups.md
bookkeeping (#44 resolved, new item for the in-process /ingredients cache)
Depends on: Session 2 (nothing to purge until /units carries a cache tag)
Commit:
Notes:
