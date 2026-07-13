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

Owns, in order: fetch each recipe via `GetRecipeByID` (still one call per id, in a loop — batching is out of scope, see below) → `CombineIngredients` → remove+add list items in one `sql.Tx` (reusing the Phase 1 `execer` interface for `RemoveIngredientListItems`/`AddIngredientListItems`) → log the Shopping List Event best-effort, outside the transaction, same as today's behavior → return the refreshed list via `GetShoppingList`.

### Phase 4 — Shrink the handler

`app/list.go`'s `createListHandler` becomes: decode `recipeIDs` from the request body → call `service.GenerateShoppingList` → encode the result. All algorithm/SQL orchestration moves out of the `app` package entirely.

### Phase 5 — Tests against a fake `execer`

Since the new interface is trivially fakeable (a plain struct recording calls, no mocking library needed) and this repo already has `go test` wired up (`list_test.go` exists, `CLAUDE.md` documents `go test ./...`), add:

- A test that a failing `insertParts` (or any step) rolls back the whole `AddRecipe`/`EditRecipe` transaction — no partial writes survive.
- A test that `GenerateShoppingList`'s remove+add is atomic — a failure in `AddIngredientListItems` after a successful `RemoveIngredientListItems` doesn't leave the Shopping List empty.

## Decisions made (grilled — do not re-litigate without a load-bearing reason)

- **Scope**: the transaction-safety fix (Phase 2) and the `GenerateShoppingList` seam (Phase 3-4) ship together — same underlying pattern (multi-statement writes with no transaction, inline in a function mixing orchestration with SQL) in both places.
- **`AddRecipe`/`EditRecipe` shape**: stay as two functions, not collapsed into one `SaveRecipe` that branches insert-vs-update internally.
- **Interface scope**: the new `execer` interface is scoped to the specific helpers that need it (Phase 1's four, plus `RemoveIngredientListItems`/`AddIngredientListItems` in Phase 3) — not introduced as a package-wide querier pattern other service functions must adopt.
- **`GenerateShoppingList` location**: `service/list.go`, matching the existing `app`/`service` split rather than living in `app/list.go`.
- **Recipe-fetch pattern**: stays the existing N sequential `GetRecipeByID` calls. Batching into one query is a separate, later optimization, not part of this change.
- **Testing**: add Go tests against a fake `execer` for the two rollback/atomicity properties above (Phase 5) — different call than the JS-side unit-test-runner question in `recipe-import-unification.md`, because Go already has test tooling here; only a DB/mocking layer was missing, and the new interface removes that blocker for free.

## Explicitly out of scope

- Batching the N-query recipe-fetch loop in `GenerateShoppingList`.
- A package-wide querier interface applied to every other service function (`GetRecipeByID`, `GetShoppingList`, etc.).
- Collapsing `AddRecipe`/`EditRecipe` into one `SaveRecipe`.
- Any DB-backed integration test harness (`sqlmock`, `TestMain`, a test database) — the fake-`execer` unit tests in Phase 5 cover rollback/atomicity logic without needing one.
