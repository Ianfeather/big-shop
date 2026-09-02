---
spec: specs/account-linking-recovery.md
status: planned
branch: implement/account-linking-recovery
pr:
---

Branched from `spec/account-linking-recovery` (PR #156, which carries the spec
itself), so the implementation PR is stacked on it rather than duplicating the
spec commits into a master-based branch.

The run was asked to proceed without stopping for questions, so step 2's
plan-mode sign-off was skipped deliberately; the Session breakdown below simply
follows the spec's own "Implementation sequence" phases, which is what step 2
asks for first anyway.

## Session 1: The resolved flag (Phase 0)
Status: pending
Scope: Widen `useRecipes` to report whether its query has resolved
  (`return [data ?? [], isSuccess] as const`). Purely additive; no call-site
  changes. Done when a test proves an unresolved query is distinguishable from
  an empty one.
Depends on: none
Commit:
Notes:

## Session 2: The server, with no UI (Phase 1)
Status: pending
Scope: `migrations/045_pending_link.sql`; `service/link.go` holding
  `StartLink` / `CompleteLink` and the narrow cascade entry point that runs
  `deleteAccountTx` (never `DeleteUserAndAccount`); `POST /link/start` and
  `POST /link/complete` in `app/link.go`; regenerated `docs/openapi.yaml` and
  `types/api.d.ts`. Tests cover: a token bound to a different subject is
  refused; an expired token is refused; a missing or wrong nonce is refused; a
  source account holding recipes is refused; a successful link leaves no
  orphaned `account` row.
Depends on: none
Commit:
Notes:

## Session 3: The flow (Phase 2)
Status: pending
Scope: `pages/link/confirm.tsx`, the `prompt=login` redirect, the localStorage
  nonce, the confirmation copy, and the `/link/confirm` entry in
  `lib/analytics/page-titles.ts` (without which the route test fails).
Depends on: Session 2
Commit:
Notes:

## Session 4: The surface (Phase 3)
Status: pending
Scope: The `/list` panel behind the resolved-and-empty condition, and the
  `/account` entry point. `/recipes` deliberately untouched.
Depends on: Sessions 1 and 3
Commit:
Notes:

## Session 5: The notification (Phase 4)
Status: pending
Scope: A new `email.Kind` and template telling the original account's address
  that a new sign-in method was added — best-effort and asynchronous, carrying
  no grant.
Depends on: Session 2
Commit:
Notes:
