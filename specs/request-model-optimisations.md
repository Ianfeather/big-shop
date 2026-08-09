# Cut the per-request round trips

Measurements and rationale: follow-up #49 (see
[`follow-ups-resolved.md`](../follow-ups-resolved.md)) and
[ADR-0006](../docs/adr/0006-go-api-leaves-netlify-functions.md)'s Measured outcome. This
spec covers the *how*.

**Not urgent, and worth saying so at the top.** Post-Fly, `GET /shopping-list` is ~165ms
and nothing here is a fire. The reason to do it is that #49 found the cost model everyone
was reasoning from was wrong by a factor of ~1.7, and #44 is already reasoning about
caching on top of it. Phases are ordered so each is independently shippable and each one
leaves the API in a working state.

## The unit of cost is a round trip, not a query

A query carrying parameters costs **two** blocking round trips, because `database/sql`
over `go-sql-driver` serves it as a server-side prepared statement (`COM_STMT_PREPARE`,
wait, `COM_STMT_EXECUTE`, wait — `COM_STMT_CLOSE` follows but the protocol sends no reply,
so it costs no waiting). A query with no parameters costs **one**. So
`round trips = 2 × parameterised + 1 × plain`, and every number below is in round trips.

## Measured baseline

Censused against the local stack via MySQL's general log, 2026-08-09. `account` is how many
times one request re-resolved `GetAccountID` from the same `userID` for the same answer.

| Route | round trips | account lookups |
| --- | --- | --- |
| `POST /shopping-list` (2 Recipes) | **50** | 9 |
| `PATCH /shopping-list/buy` | **19** | 4 |
| `GET /shopping-list` | **15** | 3 |
| `GET /shopping-list/history` | 8 | 2 |
| `DELETE /shopping-list/clear` | 8 | 2 |
| `GET /recipe/{id}` | 6 | 1 |
| `GET /recipes`, `/account`, `POST /shopping-list/extra` | 4 | 1 |
| `GET /invites` | 4 | 0 |
| `GET /user` | 2 | 0 |
| `GET /tags`, `/units`, `/ingredients` | 1 | 0 |

Plus, on **every authenticated request whatever the route**, one uncached HTTPS round trip
to Auth0's JWKS endpoint, before the first query.

`POST /shopping-list` measured 42 for one Recipe and 50 for two — **+8 per Recipe**, so a
ten-Recipe list is ~114. That slope is two independent per-Recipe loops: `GetRecipeByID`
(6) and `LogShoppingListEvent`'s one `INSERT` per Recipe (2).

---

## Phase 1 — Cache the JWKS

**First because it is independent of every other phase, touches no SQL, and the latency is
the least of what it fixes.** Big Shop's request rate is currently its Auth0 JWKS request
rate: `getPemCert` (`internal/pkg/app/app.go`) does a bare `http.Get` with no cache, and
`go-jwt-middleware` v1 calls the `ValidationKeyGetter` on every request. A rate limit or an
incident on that endpoint fails *every* request, not just logins. It is also outbound work
any unauthenticated caller can trigger, since the audience and issuer it checks first are
public values.

Measured against the real tenant: a request with a well-formed token costs ~15–18ms where
one with no token costs ~2ms, on every request rather than the first. Go's default
transport keeps the connection alive so it is normally one round trip, but `IdleConnTimeout`
is 90s, and a quiet period costs the full reconnect (~140ms measured locally; it was a
transatlantic ~350ms on the Lambda).

### Approach: upgrade to `go-jwt-middleware` v2 rather than hand-roll a cache

A JWKS cache has to get TTL, key rotation and concurrent refresh right, in the one code
path where a mistake is an auth bypass. v2 ships `jwks.CachingProvider`, which does it.

**Pin `v2.3.0`.** This is load-bearing: v2.3.1 declares `go 1.24.0` and v3 declares
`go 1.25.0`, while this repo pins Go **1.23** in four places (`netlify.toml:28`,
`.github/workflows/ci.yml:82`, `Dockerfile:7`, `Dockerfile.dev:1`). **v2.3.0 declares
exactly `go 1.23.0`** and is the last release that does. Taking anything newer means
bumping Go everywhere first — which is a reasonable thing to want (it would also unpin
Huma from v2.35.0, pinned for the same reason) but it is a different piece of work and
must not be smuggled in here.

The upgrade also retires two unmaintained dependencies: `go-jwt-middleware` v1.0.0 and
`form3tech-oss/jwt-go` (a fork of the abandoned `dgrijalva/jwt-go`).

### Actions

1. `go get github.com/auth0/go-jwt-middleware/v2@v2.3.0`; drop
   `github.com/auth0/go-jwt-middleware v1.0.0` and `github.com/form3tech-oss/jwt-go` from
   `go.mod`.
2. In `GetRouter`, replace the `jwtmiddleware.New(jwtmiddleware.Options{...})` block with:

   ```go
   issuerURL, err := url.Parse("https://" + os.Getenv("AUTH0_DOMAIN") + "/")
   provider := jwks.NewCachingProvider(issuerURL, 5*time.Minute)
   jwtValidator, err := validator.New(
       provider.KeyFunc,
       validator.RS256,
       issuerURL.String(),
       []string{os.Getenv("AUTH0_AUDIENCE")},
   )
   middleware := jwtmiddleware.New(jwtValidator.ValidateToken)
   ```

   The provider is built **once, here** — building it per request would cache nothing.
   `GetRouter` is called once from `init()`, so this is already the right place.
3. Rewrite `userMiddleware` to read v2's claims:

   ```go
   claims, ok := r.Context().Value(jwtmiddleware.ContextKey{}).(*validator.ValidatedClaims)
   ```

   and take `claims.RegisteredClaims.Subject` as the user ID. **Guard the type assertion**
   — the current line chains three unchecked assertions and is the same class of defect as
   the panic fixed in #49.
4. Delete `getPemCert`, the `Jwks` and `JSONWebKeys` types, and `normalizeAudience` — v2
   validates issuer and audience itself, and `normalizeAudience` exists only to work around
   `form3tech-oss/jwt-go`'s handling of a JSON array `aud`. Delete `TestNormalizeAudience`
   and `TestRequiredClaims` with it.
5. Keep `TestKeyLookupFailureIsRefusedNotPanicked` **unchanged**. It is the cross-version
   regression guard: an unknown `kid` must still produce a 401 and not a panic or an empty
   reply. If it needs editing to pass, that is a finding, not a chore.

### Verify

- `TestKeyLookupFailureIsRefusedNotPanicked` and `TestHealthCarveOut` pass.
- Black-box, against the real tenant, using the probe from #49: run the API locally with
  `DISABLE_AUTH=false`, `AUTH0_DOMAIN=dev-x-n37k6b.eu.auth0.com`,
  `AUTH0_AUDIENCE=https://big-shop-api`, and send repeated requests carrying a token with
  a valid `aud`/`iss` and a garbage signature. **Before:** ~15–18ms every request.
  **After:** ~15ms on the first, ~2ms on the rest.
- The e2e suite runs under `DISABLE_AUTH=true` and so exercises none of this — it is a
  guard against breaking the *other* branch of `GetRouter`, not evidence this worked.

### Known limitation, accepted

v2's `CachingProvider` caches the whole key set for the TTL and does **not** refresh on an
unknown `kid`. During an Auth0 signing-key rotation, tokens signed by a key minted inside
the current TTL window would fail until it expires. 5 minutes is chosen against that: the
tenant currently publishes two keys at once, so a new key is visible in the JWKS well
before Auth0 signs with it, and the exposure is theoretical rather than a live risk.

---

## Phase 2 — One round trip per query

**Decision required from Ian before this is implemented.** Setting `interpolateParams=true`
on the DSN makes `go-sql-driver` interpolate arguments client-side instead of preparing
server-side. **Measured: `GET /shopping-list` 15.2 → 9.2 round trips**, and the same ~40%
comes off every route in the baseline table. One DSN parameter, no code.

The trade-off is that parameter escaping moves from TiDB into the driver. The driver's
interpolation is conservative — it refuses on invalid UTF-8 and will not interpolate at all
under `multiStatements` — but "the database escapes our parameters" is a property to give
up knowingly or not at all.

**If that is not acceptable**, the alternative that keeps server-side prepares is to hold
`*sql.Stmt` values on the `App` and reuse them, paying the `PREPARE` once per connection
instead of once per query. Same win, materially more code, and it interacts with Phase 6's
pool settings because `database/sql` re-prepares a cached `Stmt` on each new connection.
Ship one or the other, not both.

### Actions

1. Add `&interpolateParams=true` to the DSN in `docker-compose.yml:39` (covers local dev
   *and* e2e).
2. Update the production DSN: `fly secrets set DSN='...&interpolateParams=true' -a big-shop-api`.
   That is the **only** other place it is set — there is no `.env` copy of it by design
   (`docker/README.md`).
3. Note it in `technical-architecture.md`'s environment table, with a one-line reason, so
   the next person to rewrite the DSN does not drop it silently.

### Verify

Run the rig (appendix) before and after. Expect the `GET /shopping-list` slope to fall from
~15.2 to ~9.2. Run `npm run test:e2e` — a mis-escaped parameter would show up as a wrong or
empty Shopping List, which those specs assert on.

---

## Phase 3 — Resolve the Account once per request

21 of the 26 service functions taking `userID string` immediately call `GetAccountID` for
themselves, so one request resolves the same Account up to **nine** times. The excess is 2
round trips each today, 1 after Phase 2.

### Approach: a lazily-resolved `Caller`, not eager middleware resolution

The obvious fix — resolve in `userMiddleware` and put the ID in the context — **would make
five routes slower**. `GET /tags`, `/units`, `/ingredients`, `/user` and `/invites` make
zero account lookups today, and eager resolution adds one to each.

So: a `Caller` value carrying the user ID and resolving the Account **on first use**,
memoised for the rest of the request. Zero stays zero; nine becomes one.

```go
type Caller struct {
    UserID    string
    db        *sql.DB
    once      sync.Once
    accountID int
    err       error
}

func (c *Caller) AccountID() (int, error) // GetAccountID once, then cached
```

This also kills the pattern rather than the symptom: today every service function is
independently responsible for answering "who is this", which is *why* it happens nine times
and why nobody noticed.

### Actions

1. Add `Caller` to `internal/pkg/common` (it is shared by `app` and `service`).
2. `userMiddleware` and `devUserMiddleware` construct one and put it in the request context
   in place of the bare `userID` string. **Both must become methods on `*App`** — they are
   free functions today and cannot reach the DB.
3. Change the 21 service functions from `userID string` to `caller *common.Caller`, calling
   `caller.AccountID()` where they called `GetAccountID(db, userID)`. `GetAccountID` itself
   stays — `Caller` is its only caller afterwards.
4. `GetShoppingList`, `GenerateShoppingList` and the history functions pass the same
   `Caller` down rather than re-deriving.

### Preserve exactly

**Do not change the error behaviour.** A user with no `account_user` row currently surfaces
`sql.ErrNoRows` from whichever service function asked, and handlers turn that into a 500.
Resolving lazily keeps that identical; resolving eagerly in middleware would turn it into a
blanket rejection and change what `POST /user` does on a genuinely new user. Fix that
separately if it is worth fixing.

### Verify

Re-census (appendix) and confirm the account-lookup column reads 1 where it read 3, 4 and
9, and **still reads 0** for `/tags`, `/units`, `/ingredients`, `/user` and `/invites`.
Full Go suite plus `npm run test:e2e`.

---

## Phase 4 — The two expensive endpoints

### 4a. `PATCH /shopping-list/buy` stops returning the whole list

19 round trips to tick a checkbox: the write is 4 and the other 15 re-run the whole of
`GetShoppingList` — both catalogs, display units, pantry marking, rounding — to build a
response body.

**Which nothing reads.** `pages/list.tsx:75` discards `buyMutation`'s result; the page
already flips the checkbox optimistically in `buyIngredient` and the surrounding comment
explains that as a deliberate design. So this is dead work end to end.

1. Change `buyListItem` to return `StatusOutput` (or 204) instead of `ShoppingListOutput`.
2. Regenerate `docs/openapi.yaml` and `types/api.d.ts` — **both are drift-checked in CI and
   will fail the build otherwise**:
   `docker compose run --rm api go run . openapi > docs/openapi.yaml` then
   `npm run generate:api-types`.
3. Confirm `pages/list.tsx` needs no change; if `apiPatch`'s generic requires one, it is a
   type-level change only.

Takes the route from 19 round trips to ~4 today, ~2 after Phases 2 and 3.

### 4b. `POST /shopping-list`'s two per-Recipe loops

- **`GetRecipeByID` per Recipe** (6 round trips each). `CombineIngredients` needs only
  `recipe.ID` and `recipe.Ingredients`, so the loop also fetches name, notes, method and
  tags per Recipe and throws them away. Replace with one query over the whole set
  (`WHERE recipe_id IN (...)`), grouped in Go.
- **`LogShoppingListEvent`'s `INSERT` per Recipe** (`history.go:16`). Replace with a single
  multi-row `INSERT` — the shape `AddIngredientListItems` uses a few lines away.

Verify with the rig at one and at two Recipes: the **slope** must go flat, not just the
intercept down. That is the whole point of the change and it is the thing a single-size
measurement cannot see.

---

## Phase 5 — Read less

### 5a. Read the `list` table once, not three times

`GetRecipesFromList`, `GetIngredientListItems` and `GetExtraListItems` query the same table
for the same Account, differing only in a `type` filter and projection. One
`SELECT ... WHERE account_id = ?` returns all of it, partitioned in Go — where the
Extras/Ingredients split already happens. Keep `ORDER BY list.id`: `GetIngredientListItems`
documents why an Item's Amounts must come back in insertion order.

### 5b. Cache the catalogs in process

`GetUnitCatalog` + `GetIngredientCatalog` are 3 round trips on both shopping-list routes,
and they load the **entire global catalog** — so they grow with the catalog, not with the
user's list.

`unit` and `ingredient` change only when a Recipe is saved. An in-process cache invalidated
on write is straightforward now and was impossible before: this is a **single long-lived
process** since ADR-0006, where on Lambda every container would have held its own stale
copy. Invalidate from `AddRecipe`/`EditRecipe` — the same write path that already coins new
Units (`components/recipe-form/Form.tsx:101` refetches `/units` for exactly this reason).

Note the overlap with **#44**, which proposes edge-caching `/units` and `/ingredients` for
*clients*. This is the complement for the API's own use, and #44 already concludes an
in-process cache is the real win for `lib/recipe-import/known-names.ts`. Do not let the two
invalidation mechanisms drift; a Recipe save has to clear both.

`GET /tags` is the extreme case — a fixed list seeded by migration that no code path writes
to (`hooks/use-tags.ts` documents this), re-read on every call.

---

## Phase 6 — The pool, and then concurrency

### 6a. Choose the pool deliberately

`main.go` sets no limits, so `database/sql` defaults apply — notably `MaxIdleConns` of 2.
Defensible when every container was short-lived; now just undecided. #49 measured a TLS
MySQL connection at **~5.0 round trips** to establish (plain TCP: ~3.0), so any concurrency
that pushes past two idle connections pays a full handshake to get one back.

Set `SetMaxOpenConns` / `SetMaxIdleConns` / `SetConnMaxLifetime` against TiDB Serverless's
own connection ceiling — that ceiling is a real number to look up, not a formality — and
expose `db.Stats()` (`OpenConnections`, `Idle`, `WaitCount`) so the choice can be checked
rather than assumed.

### 6b. Run independent reads concurrently

Once the Account resolves once, `GET /shopping-list`'s remaining reads are mutually
independent and run strictly sequentially today. An `errgroup` makes the request's depth
the slowest single query rather than the sum.

**Deliberately last.** It needs 6a's headroom to help rather than hurt, and it is worth much
less once Phases 2, 3 and 5 have taken the count down — parallelising four round trips saves
less than not making eleven of them.

---

## Where that lands

`GET /shopping-list`, measured today at 15:

| After | round trips |
| --- | --- |
| today | 15 |
| Phase 2 | 9 *(measured)* |
| \+ Phase 3 | 7 |
| \+ Phase 5a | 5 |
| \+ Phase 5b | **2** |

**Only the first is measured end to end; the rest are counted, and counting is exactly what
#49 caught being wrong.** Every phase re-runs the rig. `POST /shopping-list` (2 Recipes)
goes 50 → ~21 on Phases 2 and 3 alone, with 4b and 5b expected to roughly halve it again —
an estimate on an estimate, and the route whose cost also grows with list size, so it is
the one to measure most carefully.

## Appendix — the measurement rig

Reproduces #49's method. Total request time is linear in injected latency and **the slope
is the round-trip count**, which needs no interpretation and is immune to how the driver
logs itself.

```bash
# 1. Bring the stack up with a toxiproxy between the API and MySQL, with the api
#    service's DSN pointed at toxiproxy:3306 instead of db:3306.
#    Use an isolated project name - see CLAUDE.md on worktrees.
COMPOSE_PROJECT_NAME=bigshop-perf DB_PORT=3319 API_PORT=8091 docker compose ... up -d

# 2. Register the proxy
curl -s -X POST http://localhost:8474/proxies \
  -d '{"name":"mysql","listen":"0.0.0.0:3306","upstream":"db:3306","enabled":true}'

# 3. For each latency L in 0 10 25 50: add a downstream latency toxic, warm up
#    with one request, then time N requests and take the mean.
curl -s -X POST http://localhost:8474/proxies/mysql/toxics \
  -d '{"name":"lat","type":"latency","stream":"downstream","attributes":{"latency":25,"jitter":0}}'

# 4. slope = (mean(L=50) - mean(L=10)) / 40  ==  blocking round trips
```

Downstream-only latency is deliberate: it adds the delay once per *server response*, which
is exactly the thing a round trip waits for, so fire-and-forget commands like
`COM_STMT_CLOSE` correctly cost nothing.

For a per-statement breakdown, MySQL's general log gives the census
(`SET GLOBAL general_log=1`, reading `Prepare`/`Execute`/`Query` lines). Two gotchas that
cost time the first run: the log file must be owned by `mysql` or mysqld silently writes
nothing, and the logged `Prepare` count **over-reports** blocking round trips — trust the
slope over the log.
