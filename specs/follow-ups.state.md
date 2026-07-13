---
spec: follow-ups.md
status: complete
branch: implement/follow-ups-3-4-6
pr: PENDING
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
Status: done
Scope: new migration migrations/017_ingredient_department_unique.sql
Depends on: none
Commit: 920d13c
Notes: Verified against a fresh dev:full-style stack (isolated compose
project bigshop-wt2): migration applies cleanly (no pre-existing dupes in
dev seed data), a duplicate INSERT now fails with ERROR 1062, and existing
reads (/recipes) are unaffected. Standards + Spec review both clean; also
bumped a stale "16 files" migration count in technical-architecture.md that
review flagged as now-inaccurate.

## Session 3: Preserve bought-state across shopping list regeneration (#6)
Status: done
Scope: app/list.go createListHandler + service/list.go AddIngredientListItems — carry over is_bought by ingredient name across regeneration
Depends on: none
Commit: b353e0a
Notes: Verified end-to-end against the live dev:full-style stack: marked an
ingredient bought, regenerated with an added recipe (bought-state kept),
regenerated dropping that ingredient entirely (correctly removed, not a
preserve case), confirmed Extra items untouched throughout. Standards +
Spec review both clean (no hard violations) — noted judgement calls
(name-only ingredient keying, no-transaction delete/reinsert) are
pre-existing patterns this diff extends, not new defects; flagged as
follow-ups, not fixed here.

## Cross-session note
No Go unit tests were added in any of the three sessions. This repo has no
DB-backed test harness (no sqlmock, no TestMain, no docker-based test DB) —
building one is squarely follow-up #8's territory (frontend/backend test
framework decision), which the user explicitly deferred for this pass.
Verification instead relied on `go build`/`go vet`/`go test ./...`
(regression-only) plus manual end-to-end exercise of each fix against an
isolated `docker compose` stack (project name `bigshop-wt2`, per this
repo's multi-worktree isolation convention).
