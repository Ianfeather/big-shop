---
spec: specs/account-deletion.md
status: in-progress
branch: implement/account-deletion
pr:
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
Status: pending
Scope: Fix `DisableUserAccount`'s missing account scoping (and its caller `app/invites.go`); `service.DeleteAccount` with the enabled-member-count branch, both cascades, wired to Session 1's primitive; `DELETE FROM consent_event` before the `user` row; amend `migrations/034_consent_event.sql`'s header comment. Go tests for both branches, invites in both directions, and the consent foreign key.
Depends on: Session 1
Commit:
Notes: Sole-member branch deletes every `account_user` row for the account, not just the caller's — a disabled row would otherwise trip `fk_account_user_account_id`.

## Session 4: Phase 3 — external systems
Status: pending
Scope: `service.DeleteAuth0User` (Management API, client_credentials grant); `service.EraseSendGridRecipient` (Recipients' Data Erasure, best-effort, clean skip with no key); the five-step orchestrator (soft-gate → SendGrid → GA mapping → Auth0 → hard delete), reading `user.email` before the transaction.
Depends on: Session 3
Commit:
Notes: Auth0 skips when its credentials are unset (owner's call), logged loudly. A backlog row tracks setting the secret.

## Session 5: Phase 4 — the GA mapping table
Status: pending
Scope: Migration `036_ga_account_uuid.sql`; `service.GetOrCreateAccountUUID` minted inside `GetUser`; `common.User.analyticsId` through to `components/analytics` and `lib/analytics/ga.ts`'s `setAccount`; regenerate `docs/openapi.yaml` and `types/api.d.ts`; wire the delete into the sole-member cascade.
Depends on: Session 4
Commit:
Notes: Deleted in the sole-member branch only — in the shared case the Account survives, so rotating its UUID buys no erasure and loses the remaining members' continuity.

## Session 6: Phase 5 — the route, the UI, and the policy
Status: pending
Scope: `DELETE /account`; account-page confirmation naming which of the two outcomes will happen; `/privacy` (SendGrid erasure and the suppression carve-out, Grafana's 14-day expiry, the GA UUID as unlinkability, the right of erasure); non-destructive e2e; env documentation for `INVITE_EMAIL_PEPPER` and the Auth0 Management secrets.
Depends on: Session 5
Commit:
Notes: e2e asserts the confirmation copy and cancels — it never calls DELETE, because under `DISABLE_AUTH` the whole run shares one Account and Playwright runs spec files in parallel.
