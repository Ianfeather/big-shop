---
spec: specs/completed/request-model-optimisations.md
status: complete
branch: implement/request-model-optimisations-4-6
pr: https://github.com/Ianfeather/big-shop/pull/102
---

**All six phases have shipped.** Two runs:

| Run | Phases | Branch | PR |
| --- | --- | --- | --- |
| 1 | 1–3 | `implement/request-model-optimisations` | [#90](https://github.com/Ianfeather/big-shop/pull/90) |
| 2 | 4–6 | `implement/request-model-optimisations-4-6` | [#102](https://github.com/Ianfeather/big-shop/pull/102) |

## Scope of run 1

Phases 1–3 only, agreed with Ian at planning. Phases 4–6 (4a, 4b, 5a, 5b, 6a, 6b) were
deliberately deferred to a later run: 4a is a breaking response-shape change, 5b introduces
process-level mutable cache state, and 6a needs TiDB Serverless's connection ceiling looked
up first. **The spec therefore did not move to `specs/completed/` at the end of that run.**
It moves at the end of run 2.

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

---

# Run 2 — Phases 4–6

All three phases landed in one branch. They are ordered by dependency, not by session
boundary: 6a had to precede 6b, and 5b changes what 6b is worth.

## Session 4: Phase 4 — the two expensive endpoints
Status: done
Scope: 4a — `buyListItem` returns `StatusOutput` instead of `ShoppingListOutput`; regenerate
`docs/openapi.yaml` and `types/api.d.ts`. 4b — replace the per-Recipe `GetRecipeByID` loop
with one batched query, and `LogShoppingListEvent`'s per-Recipe `INSERT` with one multi-row
`INSERT`.
Depends on: Session 3
Commit: 84f0cca
Notes: `PATCH /shopping-list/buy` **8.09 → 2.02** round trips. No frontend change was needed
— `pages/list.tsx` already discarded `apiPatch`'s result, which is what made the old
response dead work end to end.

4b's batched query is `GetRecipeIngredientsByIDs`, and three details are load-bearing:

  1. It joins **from `recipe` with a LEFT JOIN to `part`**, not from `part`. Joining from
     `part` would make a Recipe with no Ingredient Lines indistinguishable from a Recipe
     that does not exist, collapsing `GetRecipeByID`'s `sql.ErrNoRows` distinction.
  2. One entry per *requested* id, in the requested order, so a duplicate id contributes
     twice exactly as the old loop did. Nothing sends duplicates today, but that is the
     caller's property and de-duplicating here would silently halve a total if it changed.
  3. `ORDER BY part.id`, which the old query left to the storage engine.

## Session 5: Phase 5 — read less
Status: done
Scope: 5a — collapse `GetRecipesFromList`/`GetIngredientListItems`/`GetExtraListItems` into
one `GetStoredList`. 5b — `service.Catalogs`, an in-process cache of the Unit and Ingredient
catalogs behind a 5-minute TTL, invalidated on Recipe create/edit.
Depends on: Session 4
Commit: 84f0cca
Notes: 5b's invalidation hangs off `app.purgeUnitsCache()` — the *same* call site that
purges the `units` edge tag, per the spec. That is the whole design: two caches over the
same data with different readers, and clearing one without the other is the quiet failure,
where a newly coined Unit is visible to the client while the Shopping List goes on combining
without it.

The TTL is a backstop for writes that never reach this process — a migration, a hand-edit in
the TiDB console, `scripts/sync-from-prod.sh` — and matches `/units`'s `s-maxage` so both
caches over the same data have the same worst case. A failed load is deliberately not
cached: an empty catalog is not an error the aggregation can detect, it silently degrades
every Amount to "no Unit Size known".

`Catalogs` has its own tests (load-once, invalidate, TTL, failed load not cached, and twenty
concurrent misses sharing one load under `-race`). The cached maps are handed out **by
reference, not copied** — nothing mutates a catalog today and nothing must start to.

## Session 6: Phase 6 — the pool, then concurrency
Status: done
Scope: 6a — `configurePool` in `main.go`, plus `db.Stats()` as OTel metrics. 6b — `errgroup`
over the independent reads in `GetShoppingList` and `GenerateShoppingList`.
Depends on: Session 5
Commit: 84f0cca
Notes: The ceiling the spec said to look up rather than assume: a **TiDB Cloud Starter
cluster allows 400 concurrent connections**, rising to 5,000 only with a spending limit set,
which this project does not have. Shared with the console, the SQL editor and
`sync-from-prod.sh`. Chosen: `MaxOpenConns` 20, `MaxIdleConns` 8, `ConnMaxLifetime` 5m.
`ConnMaxIdleTime` deliberately unset — holding a warm connection through a quiet period is
the point.

6a genuinely had to come first, and not only for headroom: the old default `MaxIdleConns` of
**2** is below 6b's three-connection fan-out, so one of the three would have been a fresh
handshake (~5.0 round trips) on every request and then discarded — making 6b *slower* than
sequential.

`otelsql.RegisterDBStatsMetrics` registers after `telemetry.Setup`, the same ordering trap
`otelsql.Open` has: before it, the global meter provider is the no-op one and the metrics
silently go nowhere.

## Session 7: Restore `user.sub` on every span
Status: done
Scope: Not from the spec — a defect this work introduced. Phase 3 replaced the bare `userID`
string in the request context with a `*common.Caller` and left `GetRouter`'s telemetry
accessor reading `contextKey("userID")`.
Depends on: Session 6
Commit: da2bb2d
Notes: Found while reviewing the Phase 3 diff for this run. It read a key nothing writes, so
**every span between #90 merging and this fix shipped with no `user.sub` at all**, and
nothing could notice: an absent attribute is indistinguishable from a request that genuinely
had no user.

The accessor becomes a named `userSub()` rather than an inline closure, which is the actual
fix — as a closure inside `GetRouter` it was unreachable from any test, so the coupling
between where the identity is stored and where telemetry looks for it was invisible from
every angle. The regression test was checked against the old code and fails on it
(`userSub = "", want "auth0|somebody"`). Comma-ok rather than `callerFrom`'s deliberate
panic: here a missing Caller would mean a trace attribute taking down an otherwise fine
request, which ADR-0007 forbids.

## Verification for run 2

Measured on the toxiproxy rig, against `master` (Phases 1–3) on the same database:

| Route | #49 baseline | after 1–3 | after 4–6 |
| --- | --- | --- | --- |
| `GET /shopping-list` | 15 | 7.03 | **2.08** |
| `PATCH /shopping-list/buy` | 19 | 8.09 | **2.02** |
| `POST /shopping-list` (1 Recipe) | 42 | 18.41 | **8.16** |
| `POST /shopping-list` (2 Recipes) | 50 | 21.45 | **8.10** |

**The slope went flat** — the result 4b existed for, and the one a single-size measurement
cannot see. `POST /shopping-list` cost +3.04 round trips per additional Recipe and now costs
−0.06. A ten-Recipe list was ~114 round trips at the #49 baseline and is now the same ~8 as
a one-Recipe list.

Correctness: `GET /shopping-list` and `GET /recipe/{id}` diffed between `master` and the
branch against the same database — byte-identical, except `recipes` now arrives in `list.id`
order rather than storage-engine order, which nothing reads. A Recipe carrying
`Crème "brûlée" \ 50%` was saved and read back through the new batched query, since every
e2e fixture is ASCII.

Green: full `scripts/build-local.sh` (lint, typecheck, build, `gofmt`, `go vet`,
`go test ./... -race`, and both drift checks) and all 27 e2e tests, locally and in CI.

No evidence images: the change is backend-only and the UI is byte-for-byte unchanged, which
`EVIDENCE.md` explicitly allows and which the response diff above demonstrates better than a
screenshot could.

## Two expectations the measurement corrected

- **6b is worth almost nothing on `GET /shopping-list`.** With 5b's cache in place there is
  exactly one read left for it to be independent of, so it earns its keep only on the first
  request after a Recipe save. That is the spec's own "parallelising four round trips saves
  less than not making eleven of them", arriving one phase earlier than expected.
- **2.08 is the floor**, not a number with more to give. The last round trip is the Account
  lookup every other read waits on, so going below it means changing what `Caller` does.
