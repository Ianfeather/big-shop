---
spec: follow-ups.md
status: in-progress
branch: implement/follow-ups-3-4-6
pr:
---

## Session 1: Fix RemoveUserFromAccount table name (#3)
Status: done
Scope: netlify-functions/recipes/internal/pkg/service/account.go:103-111 — delete from account_user, not user_account
Depends on: none
Commit: 3296586
Notes: Also fixed db.Query -> db.Exec (was leaking an unclosed *sql.Rows on
every DELETE) per code-review finding, and corrected a copy-pasted log
message. Verified end-to-end via DELETE /account/remove against a live
dev:full-style stack (isolated compose project bigshop-wt2). Standards +
Spec review both clean other than the db.Exec finding, which was applied.
No test coverage added — repo has no DB-backed Go test harness (no sqlmock/
TestMain) and building one is out of scope for this fix; deliberate
deferral, flagged to user in final PR.

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
