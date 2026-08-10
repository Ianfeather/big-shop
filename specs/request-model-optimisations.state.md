---
spec: specs/request-model-optimisations.md
status: in-progress
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
Status: done
Scope: The Phase 2 security review — corrects two false claims about the driver, adds the
four amendments (DSN invariants, query-text log exposure, driver bump + collation pin,
`[]byte` footgun), and states the recommendation.
Depends on: none
Commit: dc5b9ff
Notes: Written before the run started, as an answer to Ian's question about prepared-query
security. Committed first so the rest of the branch builds on the amended spec.

## Session 1: Phase 1 — Cache the JWKS
Status: done
Scope: Upgrade `go-jwt-middleware` v1 → v2.3.0, cache the JWKS via `jwks.CachingProvider`,
rewrite `userMiddleware` for v2 claims, delete `getPemCert`/`Jwks`/`JSONWebKeys`/
`normalizeAudience` and their tests. Retires `form3tech-oss/jwt-go`.
Depends on: Session 0
Commit: ce9e104
Notes: Green — gofmt, go vet, `go test ./... -race`, and the openapi drift check all pass;
`TestKeyLookupFailureIsRefusedNotPanicked`, `TestHealthCarveOut`, `TestDefaultCacheControl`,
`TestOnlyTheGlobalCatalogsOverrideTheDefault` and `TestEachRouteStampsItsOwnPolicy` verified
individually. Measured against the real Auth0 tenant: **before** 115ms then ~14-18ms every
request; **after** 96ms then ~0.02ms. The tenant does publish two keys at once, which is the
premise the 5-minute TTL rests on — confirmed by the probe.

Three deviations from the spec's literal instructions, all found by checking v2.3.0's
actual source and all agreed in the approved plan:
  1. v2 has no `HandlerWithNext` — needs a negroni adapter around `CheckJWT`.
  2. v2's default error handler answers a *missing* token with 400 where v1 answered 401.
     Must pass `WithErrorHandler` to preserve 401, or the API contract silently changes.
  3. `TestKeyLookupFailureIsRefusedNotPanicked` mints its token with `form3tech-oss/jwt-go`,
     so dropping that dep stops it *compiling*. Token construction moves to go-jose.v2;
     every assertion stays identical.

## Session 2: Phase 2 — One round trip per query
Status: done
Scope: Bump `go-sql-driver/mysql` v1.5.0 → v1.9.3 (not v1.10.0, which declares go 1.24.0),
then add `interpolateParams=true` and `collation=utf8mb4_general_ci` to the DSN. Document
both in `technical-architecture.md`, including that `multiStatements` must never be added.
Depends on: Session 1
Commit: ce07b23 (driver bump), 6539840 (interpolation)
Notes: Green — Go suite, and all 27 e2e tests pass. Measured with the toxiproxy rig:

| Route | before | after |
| --- | --- | --- |
| `GET /shopping-list` | 15.2 | **9.1** |
| `POST /shopping-list` (2 Recipes) | 50.8 | **29.4** |
| `GET /recipes` | 4.1 | **2.1** |
| `GET /tags` | 1.0 | 1.0 (no parameters) |

The before column reproduces the spec's censused baseline (15.2, 50, 4, 1) — the rig is
faithful. Both silent-failure checks done: the unsafe-collation guard is armed (pointing the
DSN at `gbk_chinese_ci` makes the API refuse to start with the expected panic, which also
proves the collation reaches the driver), and the round trips genuinely fell. Escaping
verified by round-tripping quotes, backslashes, newlines and multi-byte UTF-8 through a
Recipe, since every e2e fixture is ASCII.

Driver bump lands as its own commit before the DSN change, so a driver problem stays
separable from an interpolation problem. The collation is not optional: from v1.8 the
unsafe-collation guard is `Collation != "" && unsafeCollations[...]`, so an empty collation
disarms it. Production DSN is Ian's to set via `fly secrets` after merge — not this run.

## Session 3: Phase 3 — Resolve the Account once per request
Status: done
Scope: Add `common.Caller` resolving the Account lazily and memoising it; `userMiddleware`
and `devUserMiddleware` become `*App` methods and put a `*Caller` in the request context;
21 of 26 service functions take `*common.Caller` instead of `userID string`.
Depends on: Session 2
Commit: 03e6dac
Notes: Green — gofmt, vet, `go test ./... -race`, the openapi drift check (no drift; Phase 3
changes no API surface) and all 27 e2e tests. Censused against MySQL's general log:

| Route | account lookups before → after |
| --- | --- |
| `POST /shopping-list` | 9 → **1** |
| `PATCH /shopping-list/buy` | 4 → **1** |
| `GET /shopping-list` | 3 → **1** |
| `GET /tags`, `/units`, `/ingredients`, `/user`, `/invites` | 0 → **0** |

Round-trip slope: `GET /shopping-list` 9.1 → **7.1**, `POST /shopping-list` (2 Recipes)
29.4 → **20.9** — where the spec projected Phases 2 and 3 together would land it.

`common.Caller` has its own tests (memoisation of both value and error, laziness, and
concurrent first use under `-race`).

Lazy, not eager — `/tags`, `/units`, `/ingredients`, `/user` and `/invites` make zero
account lookups today and eager middleware resolution would make all five slower. Error
behaviour must stay identical: no `account_user` row still surfaces `sql.ErrNoRows` from the
service function that asked, and still becomes a 500.
