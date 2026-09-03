---
spec: specs/account-linking-recovery.md
status: in-progress
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
Status: done
Scope: Widen `useRecipes` to report whether its query has resolved
  (`return [data ?? [], isSuccess] as const`). Purely additive; no call-site
  changes. Done when a test proves an unresolved query is distinguishable from
  an empty one.
Depends on: none
Commit: 0895aaa
Notes: `npm run typecheck`, `npm run lint` and the full Vitest suite (54 files,
  423 tests) all green. Two new tests in hooks/use-recipes.test.ts pin that an
  in-flight query and an empty result are distinguishable. Code review deferred
  into Session 2's pass - the whole change is one returned tuple element plus
  its tests, and the code-review skill spawns two sub-agents.

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
Commit: 202f927
Notes: gofmt/vet clean; `go test ./... -race` green; `docs/openapi.yaml` and
  `types/api.d.ts` regenerated and byte-identical to their generators. Verified
  against a real MySQL as well as in unit tests - migration applies and the
  container reports healthy; wrong nonce, unknown token and a repeat of the
  caller's own provider each refused with their own status; the happy path
  links the subject, leaves no orphaned `account` row, consumes the token
  (replay refused) and leaves the surviving recipes intact; a source account
  holding a recipe is refused with the source untouched and its token still
  redeemable.

  Code review (both axes) run at this point and covering Session 1 too. Fixed:
  (1) an expiry bug the reviewer found and the tests could not - CompleteLink
  purged expired rows *before* reading the token, so an expired request came
  back as "no longer valid" rather than "expired, start again"; the purge now
  runs on the write path only, and purgeExpiredLinks says why; (2) StartLink's
  clear-then-insert is now one transaction, so a failed insert cannot leave
  somebody with neither their old attempt nor a new one; (3) the missing
  done-when test for "a token bound to a different subject is refused", added
  as TestCompleteLinkGrantsOnlyTheTokensOwnSubject with a note on what that
  bullet can mean, since its literal reading is the flow's own happy path;
  (4) `pending_link.subject` renamed `granted_subject`, which retires a
  paragraph of migration prose apologising for the name; (5) checkLink now
  takes a `pendingLink` struct so the two subjects cannot be transposed;
  (6) `technical-architecture.md`'s table list gained `pending_link` (and
  `user_identity`, which #154 had left out).

  Declined, deliberately: extracting a shared `purgeExpired(table, ...)` from
  the invite and link versions - the shared shape is four tokens of SQL and the
  generic form takes a table name as a string to interpolate, which is a worse
  thing to have than a duplicated DELETE. Also declined: a `Subject` string
  type across the codebase (the transposition risk it addresses is closed by
  the struct above), and de-duplicating the prose that argues the nonce in five
  places - this repo's standard rewards the argument being where the reader is.
  The spec's "narrow exported entry point" for `deleteAccountTx` is not built:
  the erase and the grant have to be one transaction, so the caller lives in
  the same package and needs no export. The rule the export existed to enforce
  is written down in `applyLink` instead.

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
