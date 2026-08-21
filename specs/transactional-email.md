# The transactional family

Phase 2 of `specs/completed/email.md` (#50), promoted to its own spec because Phase 1
shipped without it and a completed spec is not where anyone looks for live work.

**Scope: every email Big Shop sends because the recipient just did something.** Phase 1
built the lifecycle family — four scheduled emails on a ticker — and the seam they send
through. This spec builds the other half, which today consists of one email that has been
broken since before the architecture it was written for was decommissioned.

Absorbs the email-side of board item **#46 — Account invites are a broken branch of the
app**. #46's remaining non-email bullet (the unscoped `POST /invite/reject`) is carried
here too, and why is argued in Phase 3.

## The family, and where its members live

Six emails are transactional. Three are ours:

| Email | Cause | Recipient | State |
| --- | --- | --- | --- |
| Invite | Somebody invites you to their Account | Invitee | Exists, broken on arrival |
| Invite accepted | Your invitee joins | Inviter | Does not exist |
| Account deleted | You delete your Account | The deleted user | Does not exist |

Three are Auth0's, configured in its dashboard and not in this repository at all: Change
Password, Verification, Blocked Account. **That split is the whole reason #50 kept the
Auth0 audit as a separate item** — it is not work this codebase can do, and it is covered
here only as Phase 5, which hands over a checklist rather than a diff.

## Current state

**The invite email is the only transactional email that exists, and it does not work.**
Phase 1 moved its send onto the shared seam without changing its behaviour, deliberately,
leaving three defects in place for this spec:

- **`POST /invite` answers 400 when the send fails** (`app/user.go:269-276`), having
  already written the Invite row (`service.CreateInvite`, called at line 248, with no
  rollback). The inviter is told it failed; the invite exists and works. Note this fires
  strictly less often than it used to — with no `SENDGRID_API_KEY` anywhere, the send is
  now a clean skip rather than an error — so today the bug is latent and lands the moment
  a key is configured.
- **The accept link is dead.** `templates/invite.html:24` points at
  `https://pleeyu7yrd.execute-api.us-east-1.amazonaws.com/prod/invitation/<token>`, an API
  Gateway stack from an architecture this app no longer has. Nothing serves it.
- **`POST /invite/reject` does not scope to the caller.** `app/invites.go:75-81` calls
  `DeleteInviteByToken` with no check that the invite is addressed to the current user —
  unlike `accept`, which checks token *and* email (`app/invites.go:30`).

**One bullet #46 lists is already fixed and should not be re-litigated.** The hardcoded
`"Ian Feather" <info@ianfeather.co.uk>` sender is gone: Phase 1 settled the sender identity
once, in `service/email`, as `"Big Shop" <hello@bigshop.life>` (`email.go:60-63`).

### One of #46's premises is no longer true

#46 argues the dead link is low-severity because *"an invitee never actually needs the
email — logging in is enough for the card to appear"*, on the basis that
`components/invite/index.tsx` renders on both `pages/index.tsx` and `pages/account.tsx`.

**It renders only on `pages/account.tsx`.** The `/` copy was removed in the design overhaul
(`b3a9c40`), and `pages/index.tsx` now mentions invites only in marketing prose and an FAQ
answer. So an invitee who follows the advice of the current email — or who simply logs in —
lands on `/` and sees nothing at all. Nothing tells them `/account` is where the invitation
is waiting.

That moves the accept link from cosmetic to load-bearing, and it is why Phase 2 specifies a
deep link rather than a bare link to the site.

## The rule the family does not yet state

**A transactional send must never fail the action that caused it, and must never delay it.**

The codebase already believes this and has never written it down, which is why it holds in
one place and not the other:

- `sendWelcomeEmail` (`app/user.go:80-161`) goes to considerable trouble — a background
  goroutine, `context.WithoutCancel` so the request's cancellation does not abort the
  SendGrid call, a bounded timeout, claim-before-send against the send log, and a
  best-effort release when the send fails.
- `inviteUser` (`app/user.go:269-276`) sends inline, on the request's own context, and
  turns any error into a 400.

As an invite defect that asymmetry is a patch to one call site. As a family rule it is one
helper that all three emails go through, and the reason to build the seam before the
emails: **Phases 3 and 4 must not be able to reintroduce the bug Phase 2 removes.**

Phase 1's own package comment already frames the 400 as the mistake not to copy
(`email.go:1-8`), and `account-deletion.md` independently requires the degrade because a
hashed `invite.email` makes the row the durable artefact and the email a courtesy on top.
Three sources, one rule. It belongs in code, once.

## Phase 1 — the family seam

### The never-fail helper

One exported function in `service/email`, alongside `SendTransactional`, that owns the
rule: render and send in the background, bounded, best-effort, returning nothing the caller
can accidentally fail on.

The lifecycle side cannot simply be reused. `sendWelcomeEmail`'s claim-and-release dance
exists because the ticker is a second writer that must not double-send; transactional email
has exactly one writer — the request that caused it — and no send log. Copying the claim
would add a table and a failure mode for a race that cannot happen.

What it must keep from `sendWelcomeEmail`, because both were learned the hard way:

- **`context.WithoutCancel`, not the request context.** The request's context is cancelled
  the moment the response is written, so a goroutine holding it has its HTTP call aborted
  intermittently, depending on which wins the race.
- **A bounded timeout**, so an unresponsive SendGrid holds a goroutine rather than leaking
  one.
- **Trace context preserved**, so the send still appears under the request that caused it.

Failures are logged and recorded as telemetry warnings, never returned.

### The registry

Lifecycle declares its four emails as data — `Kind`, `Subject`, `Template`, and `EmailFor()`
to turn a kind into an entry (`lifecycle/lifecycle.go:28-101`). Transactional has subject
and template as string literals at the call site, and its one data struct
(`inviteEmailData`) declared in `app/user.go` next to the handler.

One member can carry that. Three cannot: the subjects stop being visible in one place, and
`app` accumulates template-shaped types that belong with the templates. Mirror the
lifecycle shape — a `Kind` per transactional email, a registry of subject and template
name, and the per-email data types moved next to it.

Deliberately *not* merged with `lifecycle.Email`: that type carries `Day`, which is
meaningless here, and the two families differ on the property that matters most — the
unsubscribe group. Phase 1 split `SendLifecycle` from `SendTransactional` precisely so
there is no way to send a lifecycle email down the path that skips the unsubscribe
(`email.go:258-271`). One registry over both would put that back.

**Completion:** the seam exists with tests; no behaviour has changed; every existing test
still passes.

## Phase 2 — repair the invite email

Three changes, all of them #46's:

**1. `POST /invite` returns success when the send fails.** Move it onto the Phase 1 helper,
which makes this automatic rather than a hand-written degrade. The row is already written
first; what changes is the response, not the sequence.

**2. The accept link becomes a deep link.** `templates/invite.html:24` points at
`{{ .SiteURL }}/account?invite={{ .Data.Token }}`, using the `SiteURL` the view already
carries (`email.go:162-180`) rather than a hardcoded host.

`/account` reads `?invite`, matches it against the invites `GET /invites` already returns,
and brings that card to the reader's attention. It does **not** auto-accept: accepting is a
two-outcome decision that disables the invitee's existing Account
(`app/invites.go:42-46`), and a link in an email is not consent to that.

**The token in the URL is not a credential, and this is worth being explicit about.**
`GetInvite` matches on token *and* the caller's hashed email (`service/invite.go:125-132`),
so a leaked link accepted by the wrong logged-in user resolves to no invite. The deep link
carries the token because after #59's HMAC digest it is the only plaintext handle that
survives the sending request — not because it authorises anything.

**3. `POST /invite/reject` scopes to the caller.** Not email work, and carried here anyway
because the alternative is worse: it is four lines in a file this spec already has open,
and leaving a known authorisation hole in place to preserve a ticket boundary is not a
trade worth making. `accept` already shows the shape — resolve the caller, then match the
invite against their own address.

`DeleteInviteByToken` is the wrong primitive for this path and its own doc comment says so
(*"this path never touches the email column at all"*). Reject should match on both, the way
accept does.

**4. `INVITE_EMAIL_PEPPER` is declared in `machine_config.json`.** One line, argued in
"The external setup" below. It is in this phase because it is the same invite family and
the same file-nobody-remembers-to-edit as `SENDGRID_API_KEY`; it needs `fly secrets set`
from the account holder to take effect.

**Completion:** an invite whose send fails still returns 200 and leaves a working invite;
the emailed link lands on `/account` with that invitation visible; rejecting somebody
else's invite by token fails; the pepper is declared.

## Phase 3 — invite accepted, tell the inviter

Today somebody shares their Account, the invitee joins, and the inviter finds out by
noticing. A two-line email closes the loop on the product's strongest retention feature.

Sent from `acceptInvite` (`app/invites.go:24-59`) after the membership is written and the
invite deleted — after, so a failed accept never sends a mail saying it succeeded.

**It goes to the inviter, whose address is still plaintext on `user`.** The invite row
holds `admin_id`, so the inviter is a lookup away; `GetInvite` currently returns only the
account id, so it needs to return the admin's id too, or a second read.

**This cannot be generalised into anything invite-shaped in the other direction.**
`invite.email` is an HMAC digest with no plaintext retained past the request that created
the row (`service/invite.go:17-54`), so **invites can never be resent**. If a general
resend capability is ever wanted, invites are the permanent exception, and this is the note
that says why.

## Phase 4 — the account deletion confirmation

`specs/completed/account-deletion.md` disowned this deliberately, to break a deadlock:
deletion works end to end sending zero emails, so a confirmation is purely additive.

**It has exactly one correct position** in that spec's sequence, now implemented in
`service/erasure.go:294`: **after step 1 (soft gate), before step 2 (SendGrid erasure).**

- After step 1, because the soft gate is the moment the request is actually honoured.
- Before step 2, because step 2 calls SendGrid's Recipients' Data Erasure API for that
  address (`service/erasure.go:107`). Sending afterwards would re-create in SendGrid the
  recipient data that step had just erased — an email that undoes the erasure it confirms.
- It inherits step 2's ordering constraint for the same reason step 2 has it: **read
  `user.email` before the hard delete destroys the row.** `app/account.go:124` already
  loads the user up front for exactly this, and its comment says the ordering is
  load-bearing.

Best-effort, like everything between the gate and the hard delete — which Phase 1's helper
now guarantees rather than each call site remembering. **A failed confirmation must never
abort a deletion.**

One subtlety: the sequence un-gates on a later failure (`erasure.go`'s `unGate`), so a
confirmation sent at this position can be followed by a deletion that did not happen. The
copy must therefore confirm *the request*, not assert the data is gone.

## Phase 5 — the Auth0 half (hands over, does not build)

**This phase produces a checklist, not a diff.** It needs `manage.auth0.com` and cannot be
done from this repository.

- **Which connections are enabled.** If the tenant is social-only there is no
  forgotten-password flow to fix and a chunk of the presumed family evaporates. It also
  settles `account-deletion.md`'s open question on re-signup subjects — a `google-oauth2|…`
  identity yields the same subject on re-signup, a database identity a new random one.
- **Whether Change Password, Verification and Blocked Account are still Auth0 defaults.**
  They are unbranded and say "Auth0" to somebody who has never heard of it.
- **Whether the tenant still sends via Auth0's shared dev mail provider**, which is
  rate-limited and explicitly not for production. The tenant is `dev-x-n37k6b.eu.auth0.com`
  — the `dev-` prefix is Auth0's own default naming, consistent with nothing having been
  changed.
- **The machine-to-machine client** for the Management API that `account-deletion.md`
  Phase 3 needs, plus the Fly secret it implies — which must be both set with
  `fly secrets set` *and* declared in the `api` container's `secrets` array
  (`machine_config.json:5-8`). `fly.toml:34-45` explains why at length: in a multi-container
  Machine a container receives **only** the secrets it declares, so setting one without
  declaring it leaves it absent at runtime with nothing reporting a problem.

**Then point Auth0 at SendGrid** as a custom email provider, so every email Big Shop causes
to be sent leaves from one verified `bigshop.life` sender with one SPF/DKIM alignment.
Without it there are two sending systems with two identities, one of them rate-limited.

## The external setup, and what is actually still missing

#50 and #46 both say `SENDGRID_API_KEY` "is set nowhere". **That is out of date.** #50
declared it in the `api` container's `secrets` array (`machine_config.json:7`) and
`fly.toml:40-45` records it as also set with `fly secrets set`, calling itself "the worked
example" of the two-part change. I cannot read Fly's secret store from here, so the
declaration is verified and the secret itself is taken on that comment's word — **worth
confirming with `fly secrets list` before Phase 2 lands**, because it decides whether the
invite 400 is latent or live in production today.

Still genuinely outstanding, and none of it this spec's to build:

- A verified `hello@bigshop.life` sender with a **monitored** inbox (the Day 14 lifecycle
  email asks for a reply), and SPF/DKIM on `bigshop.life`
- The ASM unsubscribe group's numeric id (lifecycle only; transactional takes no group)

### `INVITE_EMAIL_PEPPER` is undeclared, and that is a live defect

**#59 shipped the pepper. Nothing declares it.** `HashEmail` reads it from the environment
(`service/invite.go:51`) and defaults to empty, which degrades to a plain SHA-256 — by
design, for dev, e2e and CI, where there are no real addresses. In production that default
is not a degradation anybody chose.

The two commits tell the story: #59 (PR #111) introduced `INVITE_EMAIL_PEPPER`; #50 (PR
#112) edited `machine_config.json` days later and declared only `SENDGRID_API_KEY`. The
trap `fly.toml:34-45` documents at length was walked into by the next PR to touch the file.

The consequence is precisely the exposure #59 existed to close. Invites still work — the
digest is deterministic either way — so nothing fails, and that is what makes it quiet.
What is lost is the property the pepper was for: with a plain digest, anyone holding a
database dump can confirm whether a specific named person was ever invited, by hashing
their address and grepping for it.

**Fixed here rather than filed**, because it is one line in the same invite family this
spec owns and the fix is worthless without the half only the account holder can do:

1. Declare `INVITE_EMAIL_PEPPER` in the `api` container's `secrets` array — this spec's.
2. `fly secrets set INVITE_EMAIL_PEPPER=…` — **the user's**, and it must happen first.

Ordering matters and is not obvious. Setting a pepper re-keys the digest, so every invite
written under the empty default stops matching its recipient. `purgeExpiredInvites` bounds
that to 30 days, and `service/invite.go:63-65` already names the property — *"the table is
never more than ~30 days deep, so a pepper rotation self-heals within a month rather than
being a one-way door."* Any live invite at cutover needs re-sending, which per Phase 3
means re-creating, since invites cannot be resent.

## What this spec does not do

- **No resending of invites**, permanently, per Phase 3.
- **No auto-accept from the emailed link.** Accepting disables the invitee's existing
  Account; that needs a click in the app, not a click in a mail client.
- **No unsubscribe for any of these.** Transactional email is not unsubscribable and should
  not be (ADR-0010). Somebody who unsubscribes from the onboarding sequence has said
  nothing about whether they want to be told their Account was deleted.
- **No send log for transactional email.** One writer, no ticker, no double-send race.
- **No Auth0 template work**, per Phase 5 — the checklist is the deliverable.

## Open questions

1. **Does the inviter want the invite-accepted email at all?** It is the one email here
   nobody asked for; the other two confirm an action its own recipient took. It is
   transactional by cause, but it is the closest thing in the family to a notification, and
   notifications are the category that grows preferences. Shipping one is fine. Shipping
   the second without deciding where preferences live would not be.
2. **What `/account?invite=` does when the token matches nothing** — expired, already
   accepted, or addressed to somebody else. All three are indistinguishable to the
   frontend, since `GET /invites` simply will not contain it. One honest message covering
   all three is probably right, but it is copy nobody has written.
