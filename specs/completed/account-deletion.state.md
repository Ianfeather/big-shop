---
spec: specs/completed/account-deletion.md
status: complete
branch: implement/account-deletion
pr: https://github.com/Ianfeather/big-shop/pull/111
---

## Session 1: Phase 0 — the cascade primitive
Status: done
Scope: Extract `deleteRecipeData(ctx, tx, accountID, recipeIDs)` from `DeleteRecipe`; make it set-based (`recipeIDs == nil` means every Recipe in the account) and run the whole cascade in one transaction. `DeleteRecipe` becomes a one-recipe caller that keeps its `sql.ErrNoRows` sentinel.
Depends on: none
Commit: 045c857
Notes: Go suite + all 34 e2e tests green; verified against a real DB (five tables to zero, catalog intact, re-delete still 404). Code review found no correctness bugs. Applied from review: a `scope` type binding each WHERE fragment to its args (the shared list/shopping_list_event args were the fragile part), a doc comment stating that callers MUST pass a transaction since `execer` also admits *sql.DB, an ADR-0001 note that the catalog is deliberately untouched, and the ownership check moved back outside the transaction to match EditRecipe's documented precondition pattern. Kept the name `deleteRecipeData` (the spec names it) over the reviewer's `deleteRecipesCascade`.

## Session 2: Phase 1 — invite hardening
Status: done
Scope: `service.HashEmail` (HMAC-SHA256 over the lowercased, trimmed address, peppered from `INVITE_EMAIL_PEPPER`); hash at `CreateInvite`/`GetInvites`/`GetInvite`/`DeleteInvite`; lazy purge of expired rows in `CreateInvite` and `GetInvites`; migration `035_invite_email_hash.sql` plus an idempotent `hash-invite-emails` subcommand for the backfill; `/privacy` invite retention and hashing copy.
Depends on: none (independent of deletion, but sequenced after Session 1 to keep the line straight)
Commit: 0329a2c
Notes: Go suite, lint, typecheck, 367 frontend tests and all 34 e2e tests green. Verified live: a colliding pair converged on one digest row, an expired row purged in the same pass, second run a clean no-op, and the POST /invite -> GET /invites round trip still matched through the digest. Backfill is a Go subcommand (`hash-invite-emails`) rather than SQL because MySQL 8 has no HMAC and the spec rejects a plain SHA-256 — the reviewer agreed this is the only way to honour both halves of the spec. Applied from review: split `hashInvites` out behind the `execer` seam so the risky logic is unit-testable (it had no test at all), replaced the RowsAffected-based duplicate handling with an ignoring update plus one set-based sweep (RowsAffected's meaning depends on the DSN's clientFoundRows flag, a production secret), added a self-verification query since a subcommand does not run itself, and flushed telemetry on the subcommand's exit path. A test caught a real bug in the first fix: deriving the hashed count as `len(pending) - swept` goes negative when the sweep catches a straggler from an interrupted run, so the function now reports attempted/removed rather than a single derived number. Also documented INVITE_EMAIL_PEPPER in technical-architecture.md and docs/fly-migration-runbook.md (planned for Session 6; moved here because that is where the secret is introduced).

## Session 3: Phase 2 — the deletion service, database only
Status: done
Scope: Fix `DisableUserAccount`'s missing account scoping (and its caller `app/invites.go`); `service.DeleteAccount` with the enabled-member-count branch, both cascades, wired to Session 1's primitive; `DELETE FROM consent_event` before the `user` row; amend `migrations/034_consent_event.sql`'s header comment. Go tests for both branches, invites in both directions, and the consent foreign key.
Depends on: Session 1
Commit: 3473ce9
Notes: Go suite and all 34 e2e tests green; both branches verified against a real database. TWO SERIOUS BUGS found and fixed here, neither of them the feature. (1) The member-count branch would have deleted a SHARED account's recipes: it counted enabled members and treated one as "sole", but the sequence's soft gate disables the departing user's own row first, so a two-member account has one enabled row left by the time the cascade runs. The count now excludes the departing user (`user_id != ?`), which also makes it independent of gate state. Found while reasoning about the review questions, confirmed independently by the reviewer. (2) [reviewer] `DELETE FROM user` would have failed `fk_account_user_user_id` for anyone who ever accepted an invite — they hold two `account_user` rows (old disabled + new enabled) and the cascade only cleared the current account's. Now clears every membership the person holds. Also applied from review: invites sent BY the departing user are deleted (their `admin_id` is the erased person's Auth0 subject — this goes beyond the spec's table, deliberately); a membership assertion so a mismatched accountID cannot erase a stranger's account; `FOR UPDATE` on the member count, since a plain SELECT under REPEATABLE READ is a snapshot read and the comment claiming the transaction closed that race was wrong; the stale `GetUser` comment about "disables every row" corrected; and `tablesTouched` in the tests widened to catch subqueries, which made the "catalog never touched" assertion real rather than only apparent. Deferred to a new backlog row: `account_id` is varchar(255) on recipe/list/shopping_list_event but int elsewhere, so the two new account-scoped DELETEs are unindexed scans.

## Session 4: Phase 3 — external systems
Status: done
Scope: `service.DeleteAuth0User` (Management API, client_credentials grant); `service.EraseSendGridRecipient` (Recipients' Data Erasure, best-effort, clean skip with no key); the five-step orchestrator (soft-gate → SendGrid → GA mapping → Auth0 → hard delete), reading `user.email` before the transaction.
Depends on: Session 3
Commit: 8d49542
Notes: Both owed gates have since been run (see commit 293aa87). e2e green 34/34. Review found one important defect: the request context was passed straight to the cascade, so a client disconnecting after Auth0 had destroyed the identity would fail BeginTx and leave live rows for someone who could no longer log in to retry — the exact state the ordering exists to prevent. Fixed with context.WithoutCancel. Also applied: a shared 20s budget for the two network steps, draining the Auth0 token body on its error path, documenting that `called` is only meaningful when err is nil, correcting a comment that claimed this file enforced the read-email-before-delete ordering, tests for the orchestrator (it had none, and it carries the Phase 3 "Done when" property), and a hostile-subject path-escape test.
Shipped: `EraseSendGridRecipient` (best-effort, clean skip with no key, suppression entries deliberately kept), `DeleteAuth0User` (hard gate; skips when AUTH0_MGMT_CLIENT_ID/SECRET are unset per the owner's call, recording a loud warning; a 404 counts as success so a partial deletion can be retried), and `DeleteUserAndAccount` implementing the five-step sequence. `DeleteAccount` now returns whether the Account itself was deleted, decided inside its own transaction rather than re-counted afterwards. Auth0 secrets documented in technical-architecture.md and docs/fly-migration-runbook.md, which states plainly that leaving them unset is NOT a clean degradation.

## Session 5: Phase 4 — the GA mapping table
Status: done
Scope: Migration `036_ga_account_uuid.sql`; `service.GetOrCreateAccountUUID` minted inside `GetUser`; `common.User.analyticsId` through to `components/analytics` and `lib/analytics/ga.ts`'s `setAccount`; regenerate `docs/openapi.yaml` and `types/api.d.ts`; wire the delete into the sole-member cascade.
Depends on: Session 4
Commit: 293aa87
Notes: Go suite, lint, typecheck, 368 frontend tests and 34 e2e green. Verified on a fresh volume that migration 036 applies and GET /user mints a stable id lazily. Deleted in the sole-member branch only — in the shared case the Account survives, so rotating its UUID severs nothing that stays severed and splits the remaining members in two in Google. `google/uuid` was already an indirect dependency and is now direct; no new module. docs/openapi.yaml and types/api.d.ts regenerated (both drift-checked in CI).

## Session 6: Phase 5 — the route, the UI, and the policy
Status: done
Scope: `DELETE /account`; account-page confirmation naming which of the two outcomes will happen; `/privacy` (SendGrid erasure and the suppression carve-out, Grafana's 14-day expiry, the GA UUID as unlinkability, the right of erasure); non-destructive e2e; env documentation for `INVITE_EMAIL_PEPPER` and the Auth0 Management secrets.
Depends on: Session 5
Commit: 4cd9912
Notes: Go suite, lint, typecheck, 368 frontend tests, both drift checks and all 37 e2e tests green. Verified end to end in the running app through the real route AND through the UI, both branches; screenshots in specs/evidence/account-deletion/.
Review found one serious bug: a failed deletion left the account BRICKED rather than retryable — the soft gate sets enabled=false and GetAccountID filters enabled=true, so after any failure past the gate the person could neither use the app nor retry, while the UI told them to try again. Fixed with `DisableUserAccountRestore` on both abort paths, verified live.
Two /privacy sentences were overclaiming (the exact failure that page's header comment warns about): the login is NOT deleted when the Auth0 Management credentials are unset, which is production today, and SendGrid erasure does not happen with no API key. Both reworded to claims that hold in every configuration. Also from review: the `accountDeleted` flag is now actually used so the confirmation cannot tell a shared-account user "everything has been removed"; the branch no longer defaults to sole-member while GET /account is in flight; and the "only the date changes" sentence was unimplementable since the date derives from POLICY_VERSION.
POLICY_VERSION deliberately not bumped — lib/consent.ts's rule is to bump only for a new recipient, purpose or category, and these edits describe a right and reduce what Google is sent.
e2e is non-destructive by necessity; it asserts the confirmation copy against what GET /account independently reports, which caught that the dev/e2e account is SHARED (migration 008's user plus the seeded local-dev-user), so the sole-member UI path is never exercised there.
Filed: a `blocked` backlog row for setting AUTH0_MGMT_CLIENT_ID/SECRET on Fly.
