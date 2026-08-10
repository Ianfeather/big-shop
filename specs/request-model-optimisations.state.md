---
spec: specs/request-model-optimisations.md
status: planned
branch: implement/request-model-optimisations
pr:
---

## Scope of this run

Phases 1–3 only, agreed with Ian at planning. Phases 4–6 (4a, 4b, 5a, 5b, 6a, 6b) are
deliberately deferred to a later run: 4a is a breaking response-shape change, 5b introduces
process-level mutable cache state, and 6a needs TiDB Serverless's connection ceiling looked
up first. **The spec therefore does not move to `specs/completed/` at the end of this run.**

Phase 2's "Decision required from Ian" gate was answered at planning: take
`interpolateParams`, with the four amendments from the spec's security review.

## Session 0: Record the security review in the spec
Status: pending
Scope: The Phase 2 security review — corrects two false claims about the driver, adds the
four amendments (DSN invariants, query-text log exposure, driver bump + collation pin,
`[]byte` footgun), and states the recommendation.
Depends on: none
Commit:
Notes: Written before the run started, as an answer to Ian's question about prepared-query
security. Committed first so the rest of the branch builds on the amended spec.

## Session 1: Phase 1 — Cache the JWKS
Status: pending
Scope: Upgrade `go-jwt-middleware` v1 → v2.3.0, cache the JWKS via `jwks.CachingProvider`,
rewrite `userMiddleware` for v2 claims, delete `getPemCert`/`Jwks`/`JSONWebKeys`/
`normalizeAudience` and their tests. Retires `form3tech-oss/jwt-go`.
Depends on: Session 0
Commit:
Notes: Three deviations from the spec's literal instructions, all found by checking v2.3.0's
actual source and all agreed in the approved plan:
  1. v2 has no `HandlerWithNext` — needs a negroni adapter around `CheckJWT`.
  2. v2's default error handler answers a *missing* token with 400 where v1 answered 401.
     Must pass `WithErrorHandler` to preserve 401, or the API contract silently changes.
  3. `TestKeyLookupFailureIsRefusedNotPanicked` mints its token with `form3tech-oss/jwt-go`,
     so dropping that dep stops it *compiling*. Token construction moves to go-jose.v2;
     every assertion stays identical.

## Session 2: Phase 2 — One round trip per query
Status: pending
Scope: Bump `go-sql-driver/mysql` v1.5.0 → v1.9.3 (not v1.10.0, which declares go 1.24.0),
then add `interpolateParams=true` and `collation=utf8mb4_general_ci` to the DSN. Document
both in `technical-architecture.md`, including that `multiStatements` must never be added.
Depends on: Session 1
Commit:
Notes: Driver bump lands as its own commit before the DSN change, so a driver problem stays
separable from an interpolation problem. The collation is not optional: from v1.8 the
unsafe-collation guard is `Collation != "" && unsafeCollations[...]`, so an empty collation
disarms it. Production DSN is Ian's to set via `fly secrets` after merge — not this run.

## Session 3: Phase 3 — Resolve the Account once per request
Status: pending
Scope: Add `common.Caller` resolving the Account lazily and memoising it; `userMiddleware`
and `devUserMiddleware` become `*App` methods and put a `*Caller` in the request context;
21 of 26 service functions take `*common.Caller` instead of `userID string`.
Depends on: Session 2
Commit:
Notes: Lazy, not eager — `/tags`, `/units`, `/ingredients`, `/user` and `/invites` make zero
account lookups today and eager middleware resolution would make all five slower. Error
behaviour must stay identical: no `account_user` row still surfaces `sql.ErrNoRows` from the
service function that asked, and still becomes a 500.
