# Request model optimisations

Prioritised from the measurements in follow-up #49 (see
[`follow-ups-resolved.md`](../follow-ups-resolved.md) for the method). Nothing here is
designed yet; this is the ordered list of what to change and what each is worth, so the
expensive items are picked knowingly and the cheap ones are not skipped.

**None of it is urgent.** Post-Fly, `GET /shopping-list` is ~165ms and the endpoint is
fine. The reason to write it down now is that #49 found the cost model everyone was
reasoning from was wrong by a factor of ~1.7, and #44 is already reasoning about caching
on top of it.

## The unit of cost is a round trip, not a query

The single most useful correction from #49. A query carrying parameters costs **two**
blocking round trips, because `database/sql` over `go-sql-driver` serves it as a
server-side prepared statement (`COM_STMT_PREPARE`, wait, `COM_STMT_EXECUTE`, wait). A
query with no parameters costs **one**. So `round trips = 2 × parameterised + 1 × plain`,
and every count in this document is in round trips.

## Measured baseline

Every route, censused against the local stack via MySQL's general log, 2026-08-09. The
`account` column is how many times that one request re-resolved `GetAccountID` from the
same `userID` to get the same answer.

| Route | round trips | account lookups |
| --- | --- | --- |
| `POST /shopping-list` (2 Recipes) | **50** | 9 |
| `PATCH /shopping-list/buy` | **19** | 4 |
| `GET /shopping-list` | **15** | 3 |
| `GET /shopping-list/history` | 8 | 2 |
| `DELETE /shopping-list/clear` | 8 | 2 |
| `GET /recipe/{id}` | 6 | 1 |
| `GET /recipes` | 4 | 1 |
| `GET /account` | 4 | 1 |
| `GET /invites` | 4 | 0 |
| `POST /shopping-list/extra` | 4 | 1 |
| `GET /user` | 2 | 0 |
| `GET /tags`, `/units`, `/ingredients` | 1 | 0 |

Plus, on **every authenticated request regardless of route**, one uncached HTTPS round trip
to Auth0's JWKS endpoint (#52).

`POST /shopping-list` measured 42 round trips for one Recipe and 50 for two: **+8 per
Recipe**, so a ten-Recipe list is ~114. That slope is two independent per-Recipe loops —
`GetRecipeByID` (6) and `LogShoppingListEvent`'s one `INSERT` per Recipe (2).

## The list

Ordered by leverage. The first three change every route at once; the rest are per-route.

### 1. Stop preparing every parameterised query

`interpolateParams=true` in the DSN. **Measured: `GET /shopping-list` 15.2 → 9.2 round
trips**; the same ~40% comes off every route in the table. One parameter, no code.

The catch, and it is a real one: it moves parameter escaping from the database into the
driver. `go-sql-driver`'s interpolation is careful rather than clever — it refuses on
non-UTF-8 input and will not interpolate at all under `multiStatements` — but "the
database escapes our parameters" is a property to give up deliberately or not at all.

The alternative that keeps server-side prepares is to **hold `*sql.Stmt` values on the
`App` and reuse them**, so the `PREPARE` is paid once per connection at startup rather
than per query. That is the more conservative fix and costs more code: `database/sql`
re-prepares a cached `Stmt` on each new connection, so it interacts with item 8.

### 2. Resolve the Account once per request

Every service function calls `GetAccountID` for itself. The excess is 2 round trips each
today, 1 after item 1: **8 redundant lookups on `POST /shopping-list`**, 3 on `PATCH buy`,
2 on `GET /shopping-list`.

The mechanical fix is to resolve it in `userMiddleware` — which already carries a `TODO`
proposing exactly this — and read it from the request context. The better fix, and barely
more work, is to stop passing `userID string` down at all and pass a **`Caller` (or
`Session`) value carrying both the user and the resolved Account**. That kills the pattern
rather than the symptom: right now every service function is independently responsible for
answering "who is this", which is why it happens nine times and why nobody noticed.

This touches every service function's signature. That is the entire cost, and it is the
reason #49 flagged it as wanting a decision rather than an impulse.

### 3. Cache the JWKS (#52)

Removes one outbound HTTPS round trip from every authenticated request, ahead of the
database. More importantly it removes an availability coupling nobody chose: Big Shop's
request rate is currently its Auth0 JWKS request rate, so an incident or a rate limit on
that endpoint fails every request, not just logins.

`go-jwt-middleware` v2 ships a caching provider; the v1 in use here has none. Whatever is
used must refresh on an unknown `kid` and then **fail cleanly** — that path is where the
panic fixed in #49 lived.

### 4. `POST /shopping-list`'s two per-Recipe loops

The worst endpoint, and the one that does the actual work. At +8 round trips per Recipe:

- **`GetRecipeByID` per Recipe.** `CombineIngredients` needs only `recipe.ID` and
  `recipe.Ingredients`, so the loop also fetches name, notes, method and tags per Recipe
  and discards them. One query over the whole Recipe set (`WHERE recipe_id IN (...)`)
  replaces the loop.
- **`LogShoppingListEvent`'s `INSERT` per Recipe.** A single multi-row `INSERT` — the shape
  `AddIngredientListItems` already uses a few lines away.

### 5. `PATCH /shopping-list/buy` re-reads the entire list to tick one box

19 round trips, of which the write is 4 and the other 15 are re-running the whole of
`GetShoppingList` — including both catalogs and the display-unit/pantry/rounding passes —
so the response can carry the full list back.

This is a **request-model** change rather than a query optimisation, which is why it is on
this list rather than in #51: the client already knows which item it ticked. Returning 204,
or just the changed Item, makes this the cheapest write in the API instead of the second
most expensive read. Worth checking what `hooks/` actually does with the response before
changing the contract.

### 6. Read the `list` table once, not three times

`GetRecipesFromList`, `GetIngredientListItems` and `GetExtraListItems` are three queries
against the same table for the same Account, differing only in a `type` filter and which
columns they project. One `SELECT ... WHERE account_id = ?` returns all of it, partitioned
in Go — where the Extras/Ingredients split already happens anyway.

### 7. Stop re-reading the catalogs on every request

`GetUnitCatalog` + `GetIngredientCatalog` are 3 round trips on both shopping-list routes,
and they load the **entire global catalog** — so they grow with the catalog rather than
with the user's list.

`unit` and `ingredient` change only when a Recipe is saved. An in-process cache invalidated
on write is straightforward now and was impossible before: this is a **single long-lived
process** since ADR-0006, where on Lambda every container would have held its own stale
copy. Note the overlap with #44, which proposes edge-caching `/units` and `/ingredients` for
*clients* — this is the complement for the API's own use, and #44 already concludes an
in-process cache is the real win for `known-names.ts`.

`GET /tags` is the extreme case: a fixed list seeded by migration that no code path writes
to (`hooks/use-tags.ts` documents this), re-read on every call.

### 8. Choose the connection pool deliberately

`main.go` sets no limits, so `database/sql` defaults apply — notably `MaxIdleConns` of 2.
That was defensible when every container was short-lived and is now just undecided.

It matters more once item 9 lands: #49 measured a TLS MySQL connection at **~5 round trips**
to establish, so any concurrency that pushes past two idle connections pays a full handshake
to get one back. Set `SetMaxOpenConns` / `SetMaxIdleConns` / `SetConnMaxLifetime` against
TiDB Serverless's own ceiling, and expose `db.Stats()` as a metric so the choice can be
checked rather than assumed.

### 9. Run independent reads concurrently

The item that changes the *shape* rather than the count. Once the Account is resolved once
(item 2), `GET /shopping-list`'s remaining reads — the list, the unit catalog, the
ingredient catalog — are mutually independent and run strictly sequentially today. An
`errgroup` makes the request's depth the slowest single query rather than the sum of all of
them.

Deliberately last. It needs pool headroom (item 8) to help rather than hurt, and it is
worth much less once items 1, 2, 6 and 7 have taken the count down — parallelising four
round trips saves less than not making eleven of them.

## Where that lands

`GET /shopping-list`, measured today at 15:

| After | round trips |
| --- | --- |
| today | 15 |
| \+ item 1 (`interpolateParams`) | 9 *(measured)* |
| \+ item 2 (Account once) | 7 |
| \+ item 6 (one `list` read) | 5 |
| \+ item 7 (catalogs cached) | **2** |

Only the first of those is measured end to end; the rest are counted, and counting is
exactly what #49 caught being wrong. **Every one of them should be checked on the rig
before it is believed** — a `toxiproxy` between the API container and MySQL injecting a
known per-response delay, timing the endpoint at several delays, where the slope is the
round-trip count. It cost about an hour to build and it is the reason this list has numbers
at all.

`POST /shopping-list` (2 Recipes) goes 50 → ~21 on items 1 and 2 alone, and items 4 and 7
should roughly halve it again — but that one is an estimate on an estimate, and it is the
route whose cost also grows with list size, so it is the one to measure first.

## What not to do

- **Do not reach for a cache to fix a latency number** without checking the round-trip
  count first. That is how #44 came to reason about a query profile that had never been
  measured, and how "nine queries at ~160ms" survived long enough to reach an ADR.
- **Do not optimise `GET /shopping-list` and stop.** It is the endpoint that got measured
  because ADR-0006 singled it out, but `POST` costs three times as much and is the one that
  does the work.
- **Do not wait for ADR-0007's tracing to start.** Per-query spans will make all of this
  visible permanently and for free, and are strictly better than the rig above for
  production. They are not a prerequisite for any item here, and the rig already exists.
