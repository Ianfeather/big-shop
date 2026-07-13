---
spec: follow-ups.md
status: planned
branch: implement/follow-ups-3-4-6
pr:
---

## Session 1: Fix RemoveUserFromAccount table name (#3)
Status: pending
Scope: netlify-functions/recipes/internal/pkg/service/account.go:103-111 — delete from account_user, not user_account
Depends on: none
Commit:
Notes:

## Session 2: Unique constraint on ingredient_department.ingredient_id (#4)
Status: pending
Scope: new migration migrations/017_ingredient_department_unique.sql
Depends on: none
Commit:
Notes:

## Session 3: Preserve bought-state across shopping list regeneration (#6)
Status: pending
Scope: app/list.go createListHandler + service/list.go AddIngredientListItems — carry over is_bought by ingredient name across regeneration
Depends on: none
Commit:
Notes:
