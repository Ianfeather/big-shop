---
spec: specs/transactional-email.md
status: in-progress
branch: implement/transactional-email
pr:
---

## Session 1: Phase 1 — the family seam
Status: done
Scope: `service/email/transactional.go` — a `Kind` per transactional email, a registry of
subject+template mirroring `lifecycle.Sequence`, exported per-email data types, and
`SendTransactionalAsync` (background, `context.WithoutCancel`, bounded, never returns an
error). No behaviour change.
Depends on: none
Commit: 0d51d5d
Notes: go test ./... -race green, gofmt/vet clean, openapi.yaml in sync. Review gate
run inline rather than via the code-review skill (this session is under instructions
not to spawn subagents); it found a no-op `if !sent` branch, now removed, and one
behaviour change to the send-test dev command worth documenting (`--name` is now the
recipient's name only, matching what it already meant for lifecycle mail).
Known-untidy until Session 5: the preview index lists all four transactional
templates but only `invite` exists, so the other three 404 until their phases land.

## Session 2: Phase 2a — invite repairs (backend)
Status: pending
Scope: `inviteUser` onto the async helper (the 400 disappears); `GetInvite` returns
`admin_id` as well as account; `rejectInvite` scoped to the caller's own invite;
`INVITE_EMAIL_PEPPER` declared in `machine_config.json`.
Depends on: Session 1
Commit:
Notes:

## Session 3: Phase 2b — the deep link
Status: pending
Scope: `templates/invite.html` → `{{ .SiteURL }}/account?invite={{ .Data.Token }}` + golden
regen; `pages/account.tsx` reads and strips `?invite` (mirroring the `?stored=` pattern in
`pages/recipes/[id]/index.tsx`); Toast naming the inviter; `highlighted` variant on
`components/invite`. No auto-accept.
Depends on: Session 2
Commit:
Notes: Settles spec open question 2 — the no-match copy covers expired/accepted/not-yours
together, because the frontend cannot distinguish them.

## Session 4: Phase 3 — close the loop on the invite
Status: pending
Scope: invite-accepted and invite-rejected emails, both to the inviter via `admin_id` →
`service.GetUser`. Two templates + goldens. Rejected copy hands back the ability to
re-invite rather than reporting a refusal.
Depends on: Session 2 (the scoping fix is what makes the row readable), Session 1
Commit:
Notes:

## Session 5: Phase 4 — the deletion confirmation
Status: pending
Scope: template + golden; sent inside `DeleteUserAndAccount` between step 1 (soft gate) and
step 2 (SendGrid erasure), as an injectable step var so the sequence test can pin its
position. Copy confirms the request, not the outcome.
Depends on: Session 1
Commit:
Notes:

## Session 6: Phase 5 — the Auth0 handover
Status: pending
Scope: no diff. A `backlog` board row carrying the tenant-audit checklist — connections
enabled, whether the three Auth0 templates are still defaults, the shared dev mail
provider, and the M2M client `account-deletion.md` Phase 3 needs.
Depends on: none
Commit:
Notes:
