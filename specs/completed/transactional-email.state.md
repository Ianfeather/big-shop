---
spec: specs/transactional-email.md
status: complete
branch: implement/transactional-email
pr: https://github.com/Ianfeather/big-shop/pull/132
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
Status: done
Scope: `inviteUser` onto the async helper (the 400 disappears); `GetInvite` returns
`admin_id` as well as account; `rejectInvite` scoped to the caller's own invite;
`INVITE_EMAIL_PEPPER` declared in `machine_config.json`.
Depends on: Session 1
Commit: 39cf562
Notes: go test ./... -race green, gofmt/vet clean, openapi.yaml in sync. Verified
against the real stack rather than by unit test, because GetInvite/DeleteInvite take
*sql.DB and there is no DB-backed harness (board item #52):
  - reject someone else's invite by token -> 400, row intact; own invite -> 204, deleted
  - POST /invite with an invalid SendGrid key -> SendGrid 401, request 204, row written,
    failure logged in the background (on master this request is a 400)
Removed DeleteInviteByToken outright rather than leaving it unused, so no future path
can reach for the blind delete.
Hit the stale-volume trap on the way: this worktree's db volume predated migration 034,
so consent_event/email_send were missing and GET /user 500'd. `docker compose down -v`
and re-up fixed it - worth knowing the symptom looks like an application bug.

## Session 3: Phase 2b — the deep link
Status: done
Scope: `templates/invite.html` → `{{ .SiteURL }}/account?invite={{ .Data.Token }}` + golden
regen; `pages/account.tsx` reads and strips `?invite` (mirroring the `?stored=` pattern in
`pages/recipes/[id]/index.tsx`); Toast naming the inviter; `highlighted` variant on
`components/invite`. No auto-accept.
Depends on: Session 2
Commit: 09908a1
Notes: vitest 372 passed, lint/typecheck clean, invite.golden.html regenerated.
Verified in the browser against the real stack: the accessibility tree shows the toast
(role=status, "Ian Feather invited you to share their account"), the invite card, and
?invite stripped from the URL. Evidence committed in 320e943 under
specs/evidence/transactional-email/ - the rendered email, the matched arrival, and the
no-match arrival. Note for whoever captures next: claude-in-chrome returns a stale frame
after a navigation, so a screenshot can show the pre-query empty state while read_page
shows the settled DOM. A scroll forces the repaint; `wait` alone does not.
Settles spec open question 2 — the no-match copy covers expired/accepted/not-yours
together, because the frontend cannot distinguish them.

## Session 4: Phase 3 — close the loop on the invite
Status: done
Scope: invite-accepted and invite-rejected emails, both to the inviter via `admin_id` →
`service.GetUser`. Two templates + goldens. Rejected copy hands back the ability to
re-invite rather than reporting a refusal.
Depends on: Session 2 (the scoping fix is what makes the row readable), Session 1
Commit: 669947f
Notes: go test ./... -race green, gofmt/vet clean, openapi in sync. Both goldens added.
Verified against the real stack with an invalid SendGrid key - reject sends
invite-rejected (204), accept into a *different* account moves the membership and sends
invite-accepted (204); both reached SendGrid and were refused, so the request outcome is
independent of the send. Evidence: specs/evidence/transactional-email/email-invite-*.jpg.
Deferred to Session 5, because they cannot pass until account-deleted.html exists:
the account-deleted golden case, and TestEveryRegisteredEmailRenders (asserts every
Family entry has a template that renders - the registry and the templates directory are
two lists nothing else makes agree).

## Session 5: Phase 4 — the deletion confirmation
Status: done
Scope: template + golden; sent inside `DeleteUserAndAccount` between step 1 (soft gate) and
step 2 (SendGrid erasure), as an injectable step var so the sequence test can pin its
position. Copy confirms the request, not the outcome.
Depends on: Session 1
Commit: d4715c3
Notes: go test ./... -race green, gofmt/vet clean, openapi in sync. The sequence test now
pins the confirmation between soft-gate and sendgrid, with the reason recorded.
DeleteUserAndAccount took `email string`; now takes `name, address` - the greeting needs
the name, and the old name shadowed the package. Verified against the real stack: DELETE
/account on a shared account sends account-deleted, returns 200 with accountDeleted
false, account survives. Also lands the deferred TestEveryRegisteredEmailRenders.

## Session 6: Phase 5 — the Auth0 handover
Status: done
Scope: no diff. A `backlog` board row carrying the tenant-audit checklist — connections
enabled, whether the three Auth0 templates are still defaults, the shared dev mail
provider, and the M2M client `account-deletion.md` Phase 3 needs.
Depends on: none
Commit: (no diff - the deliverable is a board row)
Notes: Filed as "Audit the Auth0 tenant, and point it at SendGrid", backlog, tagged
`needs answers` - nothing external has to happen first, somebody just has to open the
dashboard. Verified the existing tag options (`blocked`, `future feature`) survived.
https://app.notion.com/p/3c3c724ecda181d2b5ccc312a9de2a07

## Not run locally: the e2e suite
`e2e/env.ts` hardcodes COMPOSE_PROJECT_NAME = 'bigshop-e2e', and that project was live
and bound to the *primary* worktree (/Users/ianfeather/Repositories/big-shop, up 14h).
`test:e2e:stop` passes --volumes, so running it from here would have destroyed that
stack - the hazard the board item "The e2e suite cannot be run from two worktrees"
describes. CI runs the same suite on a fresh runner as a required check, so the gate is
kept without taking the risk. Invites are not e2e-covered anyway (DISABLE_AUTH pins one
fixed user; accept/reject needs two).
