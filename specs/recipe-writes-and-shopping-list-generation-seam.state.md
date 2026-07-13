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
Status: pending
Scope: service/recipe.go — AddRecipe and EditRecipe each wrap their existing sequence of steps (including EditRecipe's DELETE FROM part + reinsert) in one sql.Tx, committing only if every step succeeds. Stay as two separate functions.
Depends on: Session 1
Commit:
Notes:

## Session 3: service.GenerateShoppingList
Status: pending
Scope: service/list.go — new GenerateShoppingList(recipeIDs []string, userID string, db *sql.DB) (*common.ShoppingList, error). Fetch recipes (N sequential GetRecipeByID calls, unchanged), CombineIngredients, remove+add list items in one sql.Tx (RemoveIngredientListItems/AddIngredientListItems updated to accept the Session 1 execer interface), log Shopping List Event best-effort outside the tx, return refreshed list via GetShoppingList.
Depends on: Session 1, Session 2
Commit:
Notes:

## Session 4: Shrink the handler
Status: pending
Scope: app/list.go createListHandler — decode recipeIDs, call service.GenerateShoppingList, encode result. All algorithm/SQL orchestration moves out of app package.
Depends on: Session 3
Commit:
Notes:

## Session 5: Tests against a fake execer
Status: pending
Scope: service/recipe_test.go, service/list_test.go (new) — a fake execer struct recording calls. Test: failing insertParts rolls back the whole AddRecipe/EditRecipe transaction (no partial writes). Test: GenerateShoppingList's remove+add is atomic (failure in AddIngredientListItems after successful RemoveIngredientListItems doesn't leave the Shopping List empty).
Depends on: Session 2, Session 3
Commit:
Notes:
