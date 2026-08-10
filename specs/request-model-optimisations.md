# Cut the per-request round trips

Measurements and rationale: follow-up #49 (see
[`follow-ups-resolved.md`](../follow-ups-resolved.md)) and
[ADR-0006](../docs/adr/0006-go-api-leaves-netlify-functions.md)'s Measured outcome. This
spec covers the *how*.

**Not urgent, and worth saying so at the top.** Post-Fly, `GET /shopping-list` is ~165ms
and nothing here is a fire. The reason to do it is that #49 found the cost model everyone
was reasoning from was wrong by a factor of ~1.7, and work has already started landing on
top of it — #44 shipped `Cache-Control` across the API against a query profile nobody had
measured. Phases are ordered so each is independently shippable and each one leaves the API
in a working state.

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

> **This constraint has since lifted.** The observability work (#91) moved the repo to
> **Go 1.25**, so v2.3.1 and v3 are both reachable now, as are Huma past v2.35.0 and
> `go-sql-driver/mysql` v1.10.0 (Phase 2's amendment 3 pinned v1.9.3 for exactly the same
> reason). The pins this spec shipped are therefore conservative rather than forced, and
> nothing depends on them. Taking newer versions is still its own piece of work — the point
> stands that it should not ride along inside something else.

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
6. **Do not disturb the middleware order.** `cacheControlMiddleware` sits at `app.go:288`,
   ahead of the health carve-out, CORS and auth, precisely so it stamps the JWT
   middleware's own 401s — which is what `TestDefaultCacheControl`'s first case asserts.
   Phase 1 replaces what `n.Use` is *given* at `app.go:314`, not where it sits.
   `TestDefaultCacheControl`, `TestOnlyTheGlobalCatalogsOverrideTheDefault` and
   `TestEachRouteStampsItsOwnPolicy` (all #44) must stay green; a 401 from v2's middleware
   still has to carry `private, no-store`.

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
comes off every route in the baseline table. No application code — two DSN parameters and a
driver bump, for reasons the security review below sets out.

The trade-off is that parameter escaping moves from TiDB into the driver, and
"the database escapes our parameters" is a property to give up knowingly or not at all.

**If that is not acceptable**, the alternative that keeps server-side prepares is to hold
`*sql.Stmt` values on the `App` and reuse them, paying the `PREPARE` once per connection
instead of once per query. Same win, materially more code, and it interacts with Phase 6's
pool settings because `database/sql` re-prepares a cached `Stmt` on each new connection.
Ship one or the other, not both.

**Recommendation: take `interpolateParams`.** The escaping is sound for the shape of SQL
this codebase actually writes (audited below), and the `*sql.Stmt` alternative is a lot of
code to keep a property most of the MySQL ecosystem already delegates to its driver. But
take it with the four amendments in the next section, not on the strength of the sentence
above.

### The security review, done properly

Audited 2026-08-10 against the pinned driver, **`go-sql-driver/mysql v1.5.0`**
(`netlify-functions/recipes/go.mod:13`), reading that tag's source rather than the current
docs. An earlier draft of this spec justified the trade-off with two claims about the driver
that are **false for the version we run**, and they are recorded here so nobody re-derives
the reassurance from them:

- *"It refuses on invalid UTF-8."* It does not. There is no UTF-8 validation anywhere in
  v1.5.0's interpolation path; `escapeStringBackslash` iterates bytes.
- *"It will not interpolate at all under `multiStatements`."* There is no such guard.
  `Config.normalize()` (`dsn.go:99`) checks unsafe collations and nothing else.

**What actually protects us is the charset guard, and it holds.** `dsn.go:99` refuses to
build the config when `interpolateParams` is combined with a collation from the
multibyte-escape-bypass family (`gbk`, `big5`, `sjis`, `cp932`, `gb2312`, `gb18030`). Our
DSN sets no `collation=`, so v1.5.0 defaults to `utf8mb4_general_ci`, which is safe. The
failure mode is fail-closed: `sql.Open` errors and the process does not start. Escaping
covers `\x00 \n \r \x1a ' " \` and switches to quote-doubling when the server advertises
`NO_BACKSLASH_ESCAPES`.

**The call sites are clean.** Every user value in `internal/pkg/service` is a real
placeholder. The five `fmt.Sprintf` sites in `recipe.go` (`:391`, `:414`, `:433`, `:463`,
`:549`) build `(?,?)` lists, not values; the one interpolated *identifier*
(`setIngredientUnitColumn`, `recipe.go:549`) is a column name chosen from two Go literals
and is unaffected either way. No `LIKE`/`REGEXP` over user-supplied patterns, no `[]byte`
arguments, and no static query containing a literal `?` — which matters because the driver
decides whether to interpolate by counting `?` textually (`strings.Count`), so a `?` inside
a quoted literal in a query would be substituted into if the arg count happened to match.

So: **no injection exposure.** The four amendments below are what the trade-off actually
costs.

#### 1. Two DSN parameters must never appear, and only one is enforced

`collation=` set to one of the unsafe six is refused by the driver. `multiStatements` is
**not** — and it is the parameter that would turn any future escaping defect into stacked
statements. Neither is in the DSN today. Treat both as invariants of this repo, recorded in
`technical-architecture.md`'s environment table alongside `interpolateParams` itself.

#### 2. User data and bearer secrets move into query text, which is logged

This is the real consequence and the previous draft did not mention it. Parameterised, an
invite is sent as `INSERT INTO invite (token, account, email, ...) VALUES (?, ?, ?, ?, ?)`
with the values on a separate wire path. Interpolated, the literal token and email address
are *in the statement* (`internal/pkg/service/invite.go:18`, `:64`) — and therefore in
MySQL's general log, the slow-query log, TiDB Cloud's slow-query UI, and any driver error
text that reaches our own 25-odd `log.Printf` sites in the service layer. **An invite token
is a bearer capability**: whoever reads a slow-query log can join an account. Recipe content
and user emails take the same path.

Accepted, not ignored: TiDB only captures statements past the slow-query threshold, so this
is an exposure of the slow tail rather than of every request. Note it, and do not add
statement-level logging to the API without revisiting it.

#### 3. Bump the driver as part of this phase — and pin the collation when you do

v1.5.0 is from January 2020. Interpolation moves security-critical code out of TiDB and into
that pinned dependency, which changes what keeping it patched is worth. **Go to `v1.9.3`.**
The same Go-version trap as Phase 1's `go-jwt-middleware` pin applies and has been checked:
`v1.9.3` declares `go 1.21.0` and is fine against this repo's Go 1.23, while **`v1.10.0`
declares `go 1.24.0`** and would drag the Go bump into this work.

One catch that makes the bump load-bearing rather than hygienic: from v1.8 the driver's
`Collation` **defaults to empty** and the guard became
`cfg.InterpolateParams && cfg.Collation != "" && unsafeCollations[cfg.Collation]`
(`dsn.go:174` in v1.9.3). With no collation in the DSN the guard is a no-op and the
connection charset comes from the server default. So the bump must add
`&collation=utf8mb4_general_ci` to the DSN explicitly — otherwise upgrading *removes* the
protection described above without any visible change.

#### 4. A footgun for later: `[]byte` arguments

A `[]byte` argument interpolates as `_binary'…'`, which forces a binary comparison — so
`WHERE name = ?` would become case-**sensitive** and quietly break the case-insensitive
matching that `migrations/032_pantry_staple.sql:33` and `recipe.go:602` depend on. There are
no `[]byte` arguments today. There must not be one added without knowing this.

### Actions

1. `go get github.com/go-sql-driver/mysql@v1.9.3` — **before** turning interpolation on, so
   the two changes are separable if the bump misbehaves. Not `v1.10.0` (see amendment 3).
2. Add `&interpolateParams=true&collation=utf8mb4_general_ci` to the DSN in
   `docker-compose.yml:39` (covers local dev *and* e2e). **Both parameters, together** —
   amendment 3 explains why the collation is not optional once the driver is bumped.
3. Update the production DSN:
   `fly secrets set DSN='...&interpolateParams=true&collation=utf8mb4_general_ci' -a big-shop-api`.
   That is the **only** other place it is set — there is no `.env` copy of it by design
   (`docker/README.md`).
4. Note all of it in `technical-architecture.md`'s environment table: what
   `interpolateParams` buys, why `collation` is pinned next to it, and that
   **`multiStatements` must never be added** (amendment 1) — so the next person to rewrite
   the DSN does not drop half of it silently.

### Verify

Run the rig (appendix) before and after. Expect the `GET /shopping-list` slope to fall from
~15.2 to ~9.2. Run `npm run test:e2e` — a mis-escaped parameter would show up as a wrong or
empty Shopping List, which those specs assert on.

Then check the two properties the security review depends on, because both fail silently:

- **The guard is armed.** Temporarily set `collation=gbk_chinese_ci` in the local DSN and
  confirm the API refuses to start with `invalid DSN: interpolateParams can not be used
  with unsafe collations`. If it starts, the collation is not reaching the driver and
  amendment 3 has bitten.
- **Round trips actually fell.** The driver falls back to a server-side prepare
  (`driver.ErrSkip`) for any argument type it cannot interpolate and for statements over
  `maxAllowedPacket`, so the win is not uniform by construction. The slope is the check.

Non-ASCII is worth one deliberate pass by hand — save a Recipe with an ingredient name
carrying quotes, a backslash and a multi-byte character (`Crème "brûlée" \ 50%`) and read it
back — since e2e fixtures are all ASCII and would not notice an escaping regression.

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

**This is a different cache from the one #44 shipped, and they have to be invalidated
together.** #44 (resolved, [ADR-0009](../docs/adr/0009-edge-caching-the-global-catalogs.md))
put `GET /units` behind Netlify's edge with a `units` cache tag, purged on Recipe
create/edit through the new `internal/pkg/purge` package. That cache serves *clients*; this
one serves the API's own combining logic. A Recipe save must clear both, so hang the
in-process invalidation off the same call site in `AddRecipe`/`EditRecipe` that already
purges the tag — one place that knows the catalog changed, not two that have to stay in
step.

Not to be confused with **#51** either, which is a third path: `/ingredients` fetched from a
Netlify function by `lib/recipe-import/known-names.ts` on every import. Same table, but that
round trip is Ohio → Frankfurt and an in-process cache in a Netlify function is exactly what
#51 argues is the weakest of its three options. Nothing here depends on how #51 resolves; if
it resolves by moving extraction into the Go API, this cache serves that too.

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
