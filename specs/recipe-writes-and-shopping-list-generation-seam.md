# Give recipe writes and shopping-list generation their own seam

## Current state (why this isn't greenfield)

`netlify-functions/recipes/internal/pkg/service/recipe.go`'s `AddRecipe` and `EditRecipe` each call `insertIngredients` → `insertUnits` → `insertParts` (delete-then-reinsert, for Edit) → `insertTags` as four independent, unwrapped `db.Exec` calls against `*sql.DB`. A failure partway through — e.g. after `DELETE FROM part` but before the reinsert — leaves a Recipe with no Ingredient Lines. There is no transaction anywhere in this path.

`netlify-functions/recipes/internal/pkg/app/list.go`'s `createListHandler` fuses JSON decoding, a loop of `strconv.Atoi` + `service.GetRecipeByID` per recipe id, the `CombineIngredients` aggregation algorithm, and SQL orchestration (`RemoveIngredientListItems` → `AddIngredientListItems`, also unwrapped — a failure between them leaves the Shopping List empty) all directly in the HTTP handler. "Generate Shopping List" as a domain operation only exists as this handler's control flow; there is no `GenerateShoppingList` function a test (or another caller) could call independently of HTTP.

Neither gap is exotic to fix, but two facts about this codebase shape *how*: there is currently no interface of any kind anywhere in the Go service layer — every function takes a concrete `*sql.DB` — and there is no DB-backed test infrastructure (no `sqlmock`, no `TestMain`, no test database). `service/list.go` already exists, though, holding `GetShoppingList`/`RemoveIngredientListItems`/`AddIngredientListItems`/etc. — the `app`/`service` split (HTTP handlers vs. domain+DB) is an established convention this change fills a gap in, not a new pattern.

## Proposed approach

### Phase 1 — Minimal `execer` interface

In `service/recipe.go`, define a small interface covering just what `insertIngredients`/`insertUnits`/`insertParts`/`insertTags` actually call (`Exec`, and `QueryRow` where needed elsewhere in the file). `*sql.DB` and `*sql.Tx` both already satisfy it with no wrapper code. Change those four functions to accept it instead of a concrete `*sql.DB`.

This is the first interface anywhere in this Go codebase — deliberately scoped to these four helpers only, not declared as a package-wide pattern other service functions must now adopt.

### Phase 2 — Transaction-wrap `AddRecipe` and `EditRecipe`

Keep them as two separate exported functions (their semantics genuinely differ — `EditRecipe` does an ownership check before updating; `AddRecipe` is a plain insert). Each wraps its own existing sequence of steps — including, for `EditRecipe`, the `DELETE FROM part` + reinsert — in one `sql.Tx`, committing only if every step succeeds.

### Phase 3 — `service.GenerateShoppingList`

Add to `service/list.go` (alongside the list functions that already live there):

```
GenerateShoppingList(recipeIDs []string, userID string, db *sql.DB) (*common.ShoppingList, error)
```

Owns, in order: fetch each recipe via `GetRecipeByID` (still one call per id, in a loop — batching is out of scope, see below) → fetch the current Ingredient Items via `GetIngredientListItems` → `CombineIngredients` → carry `IsBought` forward onto any recomputed Ingredient Item that was already bought under the same name (matching `createListHandler`'s existing behavior from a prior follow-up fix — regenerating the list must not silently un-buy things) → remove+add list items in one `sql.Tx` (reusing the Phase 1 `execer`/`dbConn` interfaces for `RemoveIngredientListItems`/`AddIngredientListItems`) → log the Shopping List Event best-effort, outside the transaction, same as today's behavior → return the refreshed list via `GetShoppingList`.

**Also needed, discovered during implementation (not anticipated when this spec was written):** `GetAccountID` — a transitive dependency of `RemoveIngredientListItems`/`AddIngredientListItems` when called inside the transaction — needs `QueryRow`, not just `Exec`. `dbConn` (a small interface embedding `execer` plus `QueryRow`) is introduced in `service/recipe.go` alongside `execer`, and `GetAccountID`'s parameter type widens from `*sql.DB` to `dbConn`. This is a pure widening: every existing caller already passes a concrete `*sql.DB`, which still satisfies `dbConn`, so no other call site changes. `CombineIngredients` also moves from `app/list.go` into `service/list.go` (a mechanical necessity — `service` can't import `app`, which already imports `service`), temporarily duplicated in both packages until Phase 4 deletes `app/list.go`'s copy.

### Phase 4 — Shrink the handler

`app/list.go`'s `createListHandler` becomes: decode `recipeIDs` from the request body → call `service.GenerateShoppingList` → encode the result. All algorithm/SQL orchestration moves out of the `app` package entirely. Also delete `app/list.go`'s now-superseded `CombineIngredients` and its test (moving the test to `service/list_test.go` alongside the function it now tests, not just deleting it — losing coverage on a refactor is a regression).

**Also needed, discovered during implementation:** collapsing the handler's several distinct pre-existing error paths (bad recipe id → 400; every other failure → 500, each with its own message) into one generic `GenerateShoppingList` error would silently turn the bad-id case into a 500 too — a real HTTP-semantics regression a client shouldn't have to absorb. Fixed by having `GenerateShoppingList` return a sentinel `ErrInvalidRecipeID` for that specific case, which the handler unwraps with a plain `==` check (matching the existing convention in `app/recipe.go`'s `sql.ErrNoRows` handling) to restore the 400 — without reintroducing any orchestration into `app`.

### Phase 5 — Tests against a fake `execer`

**Revised during implementation — the original scope below turned out to be structurally unachievable with a pure fake, for reasons specific to Go's standard library, not this codebase.** `AddRecipe`, `EditRecipe`, and `GenerateShoppingList` all take a concrete `*sql.DB` (not an interface) so they can call `.Begin()` — a fake can't be substituted for that parameter at all, since `*sql.DB` is a concrete type satisfied only by itself. Separately, `dbConn` (needed by `RemoveIngredientListItems`/`AddIngredientListItems`, and transitively `GetAccountID`) requires `QueryRow(...) *sql.Row`, and `sql.Row` has no exported constructor anywhere in `database/sql` — only `*sql.DB`/`*sql.Tx` can produce one. So neither "rolls back the whole `AddRecipe`/`EditRecipe` transaction" nor "`GenerateShoppingList`'s remove+add is atomic" is testable against the exported functions with a hand-written fake, without either a real database or a full fake SQL driver (`sql.Register`) — the latter being materially the same undertaking as the `sqlmock`/test-database options this spec's "Explicitly out of scope" section already ruled out.

What ships instead: fake-`execer` tests for `insertIngredients`/`insertUnits`/`insertParts`/`insertTags` (`service/recipe_test.go`) — these four take only `execer` (`Exec`, no `QueryRow`), so they're genuinely fakeable. Each test confirms the right SQL shape (one batched upsert/insert per call, `insertTags`'s delete-then-conditional-insert) and that a failing `Exec` propagates as an error without attempting the next step. This is real, new, deterministic coverage of the SQL-building/error-propagation logic — the actual transaction rollback and remove+add atomicity properties were instead verified live against a real MySQL database during Sessions 2 and 3 (forcing a real failure via a Tag FK-constraint violation, inspecting DB state before/after) — see those Sessions' state-file notes for what was checked and what passed.

## Decisions made (grilled — do not re-litigate without a load-bearing reason)

- **Scope**: the transaction-safety fix (Phase 2) and the `GenerateShoppingList` seam (Phase 3-4) ship together — same underlying pattern (multi-statement writes with no transaction, inline in a function mixing orchestration with SQL) in both places.
- **`AddRecipe`/`EditRecipe` shape**: stay as two functions, not collapsed into one `SaveRecipe` that branches insert-vs-update internally.
- **Interface scope**: the new `execer` interface is scoped to the specific helpers that need it (Phase 1's four, plus `RemoveIngredientListItems`/`AddIngredientListItems` in Phase 3) — not introduced as a package-wide querier pattern other service functions must adopt.
- **`GenerateShoppingList` location**: `service/list.go`, matching the existing `app`/`service` split rather than living in `app/list.go`.
- **Recipe-fetch pattern**: stays the existing N sequential `GetRecipeByID` calls. Batching into one query is a separate, later optimization, not part of this change.
- **Testing**: add Go tests against a fake `execer` (Phase 5) — different call than the JS-side unit-test-runner question in `recipe-import-unification.md`, because Go already has test tooling here. **Revised during implementation**: the fake can only cover `insertIngredients`/`insertUnits`/`insertParts`/`insertTags` (the only `execer`-only functions) — see Phase 5 for why the rollback/atomicity properties themselves aren't fake-testable at the `AddRecipe`/`EditRecipe`/`GenerateShoppingList` level, and were verified live against a real database instead.

## Explicitly out of scope

- Batching the N-query recipe-fetch loop in `GenerateShoppingList`.
- A package-wide querier interface applied to every other service function (`GetRecipeByID`, `GetShoppingList`, etc.).
- Collapsing `AddRecipe`/`EditRecipe` into one `SaveRecipe`.
- Any DB-backed integration test harness (`sqlmock`, `TestMain`, a test database, or a hand-written fake `sql.Driver`) — the fake-`execer` unit tests in Phase 5 cover the write-helpers' SQL-building/error-propagation logic; transaction rollback and remove+add atomicity were verified live instead (see Phase 5).
