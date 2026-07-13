---
spec: specs/recipe-writes-and-shopping-list-generation-seam.md
status: in-progress
branch: implement/recipe-writes-and-shopping-list-generation-seam
pr:
---

## Session 1: Minimal execer interface
Status: done
Scope: service/recipe.go — define a minimal interface (Exec, and QueryRow where needed) covering what insertIngredients/insertUnits/insertParts/insertTags actually call. Change those four functions to accept it instead of a concrete *sql.DB.
Depends on: none
Commit: 6ee670a
Notes: Test gate: go build/go test both clean (via big-shop-api Docker
image - Go toolchain isn't installed on this host). Review gate clean -
confirmed execer correctly has only Exec (none of the four functions call
QueryRow; that's only used by EditRecipe/DeleteRecipe's ownership check,
untouched this session), no scope creep, pure behavior-preserving refactor.

## Session 2: Transaction-wrap AddRecipe and EditRecipe
Status: done
Scope: service/recipe.go — AddRecipe and EditRecipe each wrap their existing sequence of steps (including EditRecipe's DELETE FROM part + reinsert) in one sql.Tx, committing only if every step succeeds. Stay as two separate functions.
Depends on: Session 1
Commit: f412741
Notes: Test gate: go build/vet/test clean. Live end-to-end verify against a
real MySQL DB (dev:full, fresh volume): forced a failure at insertTags (the
last step) via a tag name that violates recipe_tag's FK constraint on
tag_name - confirmed AddRecipe's transaction rolled back the
already-successful recipe insert + ingredients/units/parts (recipe count
unchanged, no orphaned row), and EditRecipe's transaction rolled back the
UPDATE + delete-and-reinsert-parts sequence (original name/method/
ingredient unchanged after the failed request). Review gate clean - defer
tx.Rollback() after a successful Commit() confirmed safe (stdlib no-ops via
an atomic CAS on tx.done, doesn't touch the connection), LastInsertId()
error check confirmed a necessary correctness fix for the tx-wrap (not
scope creep), two-function shape matches the spec decision verbatim.

Note: while verifying this session, corrected a wrong root-cause diagnosis
from recipe-import-unification.md's Session 4 notes (a stale Docker volume
from an unrelated session, not a real missing-unique-constraint bug - see
that spec's state file and its follow-up correction commit 8377c24).

## Session 3: service.GenerateShoppingList
Status: done
Scope: service/list.go — new GenerateShoppingList(recipeIDs []string, userID string, db *sql.DB) (*common.ShoppingList, error). Fetch recipes (N sequential GetRecipeByID calls, unchanged), fetch current Ingredient Items and carry IsBought forward, CombineIngredients, remove+add list items in one sql.Tx (RemoveIngredientListItems/AddIngredientListItems updated to accept a new dbConn interface), log Shopping List Event best-effort outside the tx, return refreshed list via GetShoppingList.
Depends on: Session 1, Session 2
Commit: aaf186b
Notes: Test gate: go build/vet/test clean. Live end-to-end verify (dev:full,
since torn down) via a temporary uncommitted Go program calling
GenerateShoppingList directly: cross-recipe aggregation + 1000-unit
threshold conversion correct, full-replace correctly scoped to Ingredient
Items only (a pre-existing Extra Item survived two regenerations), and
IsBought correctly preserved/dropped across regeneration (see below).
Review gate: 1 real gap caught and fixed before commit - my first draft
omitted the IsBought carry-over that createListHandler already does (from
a prior follow-up fix); would have been a silent regression once Session 4
wires the handler to this function. Fixed and re-verified live. Also
confirmed as necessary, not scope creep: CombineIngredients duplicated into
service/list.go (service can't import app; TODO left marking the app-side
copy for Session 4 deletion), and a new dbConn interface (execer +
QueryRow) added since GetAccountID - a transitive dependency of
RemoveIngredientListItems/AddIngredientListItems - needs QueryRow. Spec
doc corrected (Phase 3 description) to reflect both.

## Session 4: Shrink the handler
Status: pending
Scope: app/list.go createListHandler — decode recipeIDs, call service.GenerateShoppingList, encode result. All algorithm/SQL orchestration moves out of app package. Also delete app/list.go's now-superseded CombineIngredients and its test (app/list_test.go), per the Session 3 TODO.
Depends on: Session 3
Commit:
Notes:

## Session 5: Tests against a fake execer
Status: pending
Scope: service/recipe_test.go, service/list_test.go (new) — a fake execer struct recording calls. Test: failing insertParts rolls back the whole AddRecipe/EditRecipe transaction (no partial writes). Test: GenerateShoppingList's remove+add is atomic (failure in AddIngredientListItems after successful RemoveIngredientListItems doesn't leave the Shopping List empty).
Depends on: Session 2, Session 3
Commit:
Notes:
