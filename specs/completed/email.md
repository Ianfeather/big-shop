# Email: the onboarding sequence, and the transactional family

Implements the [bigshop board](https://app.notion.com/p/87fae8a2ed054f2c874201e827639bd8)'s
**#50 — Email: Big Shop sends exactly one, and it doesn't work**. Establishes
[ADR-0010](../docs/adr/0010-lifecycle-email-lawful-basis.md) (the lawful basis) and works
within [ADR-0008](../docs/adr/0008-what-telemetry-does-not-carry.md) §1. Inherits hard
constraints from `account-deletion.md` (#59) and carries one back to it.

Big Shop sends exactly one email today — the Account invite — and it is broken end to end.
This spec covers the family that does not exist at all as well as the one that does.

## The framing #50 proposed, and why it is not the one built

#50 described the lifecycle family as scheduled and behavioural: *"something has to decide
'this Account signed up three days ago and has one Recipe' and send."* **That is rejected,
and it is the most important decision in this document.**

The reason is false positives. Any behavioural threshold — three Recipes saved, a list
cleared, Recipes added to a list — is reachable by someone poking at the product in a
non-meaningful way, and the moment they cross it they are marked activated and the
sequence stops. The state that is cheap to measure is trial-shaped, and trial-shaped usage
is exactly what a threshold cannot tell apart from real usage. Building the qualification
machinery would buy a signal that is wrong in the direction that hurts: silence to the
people most in need of the next email.

So there is no activation ladder, no per-Account state evaluation, no qualification query,
and no branching. **A fixed four-email sequence on days-since-signup goes to everyone.**
The constraint this imposes is on the copy rather than the code: every email has to be
worth reading regardless of what the Account holds, because nothing checks.

**This dissolves the dependency on #42 that #50 predicted.** #50 said *"#42 is the reason
the lifecycle emails would work or not — a retention email pointing someone back into an
empty Account is the same wound from a different angle."* True of the behavioural design.
Not true of this one: the Day 8 email *supplies* recipes rather than pointing at an empty
Account, so it is a partial answer to #42's wound rather than a victim of it. #42 and this
item can now ship in either order.

## Current state

**The one email that exists.** `app/user.go:139-152`, inline in `inviteUser`, at request
time. A hardcoded sender (`"Ian Feather" <info@ianfeather.co.uk>`), a link to
`https://pleeyu7yrd.execute-api.us-east-1.amazonaws.com/...` — an API Gateway stack from an
architecture this app no longer has, serving nothing — and a `SENDGRID_API_KEY` read from
an environment that has never had one. `POST /invite` therefore 400s on every call. #46
owns the fix; `account-deletion.md` Phase 1 depends on part of it.

**Genuinely absent:** any scheduler, any send log, any suppression list, any unsubscribe
mechanism, any template, any welcome email, any verified sender identity, and any record
of what has been sent to whom.

**Present and useful:** `user.email` is upserted on every login (`service/user.go:11`), so
a list exists. `user.created_at` exists (`migrations/008_user.sql`). Nobody has ever
checked how complete or accurate the address column is, and this spec does not assume it
is — a null or malformed address is a skip, not an error.

**Not a deployment blocker either way.** `SENDGRID_API_KEY` is read per-request rather than
at startup, verified by booting the production image without it: clean start, `/health`
200. Everything below must preserve that property.

## Phase 1 — the onboarding sequence

### What, and when

| | Email | When | Content |
| --- | --- | --- | --- |
| 1 | Welcome | Day 0, inline on signup | What it is for, and the one thing to do now |
| 2 | Tips | Day 3, 10:00 local | Import from a URL, the list combining itself, sharing an Account |
| 3 | Recipes to add to your list | Day 8, 10:00 local | A handful of good ones, one click to add |
| 4 | How's it going? | Day 14, 10:00 local | Feedback ask, replies land in `hello@bigshop.life` |

Four rather than five or six: one tips email rather than two, and a fortnight rather than
three weeks. The risk knowingly accepted is that a single tips email becomes a feature
list nobody finishes reading, which is a copy problem to solve in the writing rather than
a reason to add a send.

### Who gets it

**Per-User, keyed on `user.created_at`.** Not per-Account. Two Users sharing an Account
each get all four on their own clock, because the emails teach a *person* how to use the
product and the second person in a shared Account is frequently the one doing the
shopping.

**Invitees are included.** Someone who arrives by accepting an invite is new to Big Shop
even though the Account they land in is full of Recipes. Suppressing them was considered
and rejected: it would deny the tips and feedback emails to exactly the users who arrived
through the best channel, in exchange for avoiding one mildly redundant email.

**New signups only.** The sequence fires only for `user.created_at` after a launch cutoff
constant. The existing user base gets nothing from it — a deliberate decision, not an
oversight: "Welcome to Big Shop!" landing on someone who joined eight months ago reads as
broken, and long-dormant addresses are the likeliest to mark a first send as spam, which
poisons the suppression list permanently on a brand-new sending domain. A separate backlog
row covers a one-off broadcast to them, and it is where the feedback actually is, so it
should not be left to rot.

### The lawful basis, and what it forbids

**Legitimate interests, as service email, with unsubscribe in every send.** The full
argument and the rejected alternatives are in
[ADR-0010](../docs/adr/0010-lifecycle-email-lawful-basis.md); it is there rather than here
because it is a standing policy decision that outlives this spec, and specs get moved to
`specs/completed/` where nobody looks for one.

What matters for implementation is the condition the basis is contingent on:

> **The sequence must stay strictly non-promotional.** No referral pitch, no upsell, no
> third-party content, no discount, no "invite your friends and get X".

This is not stylistic. The basis holds because these are onboarding messages about a
service the recipient actively signed up for. Add a promotional call to action and they
become direct marketing, at which point they require opt-in consent and the whole design
changes. Anyone editing this copy later needs to know that, which is why it is stated in
the templates themselves as well as here.

### The scheduler

**An hourly `time.Ticker` goroutine inside the Go API on Fly.**

This is the first scheduler in the repository, which `account-deletion.md` predicted:
*"there is no scheduler in this architecture and inventing one for a single `DELETE` is
disproportionate."* That was right for one `DELETE` and this is the thing that changes it.

It works because of a property already committed in `fly.toml`: `auto_stop_machines =
false` on a single always-on machine, chosen so cold starts could not happen. That means
exactly one process, always running, so there is **one ticker and no leader election** —
the entire distributed-systems problem is absent by construction rather than by care.

Hourly rather than daily because sends are at 10:00 in the *recipient's* timezone, so the
ticker has to wake up often enough to catch every zone's 10:00.

Rejected, with reasons, so they are not re-proposed:

- **A Fly scheduled Machine.** Cleanly isolated, and a crash in it could not take the API
  down. Costs a second deploy artefact to keep in sync, and Fly's schedule granularity is
  hourly/daily with no cron expression — so it buys isolation and pays it straight back.
- **GitHub Actions cron hitting a protected endpoint.** Most visible: every run is a
  logged, re-runnable workflow. But it needs a shared secret and a new authenticated route
  on the public API, and scheduled runs are routinely delayed 10–30+ minutes or dropped
  under load. Acceptable for a daily email, genuinely bad as the repo's only scheduling
  primitive — and it would become that.
- **SendGrid Marketing Campaigns automations.** No scheduler code at all, but it requires
  syncing every user into SendGrid as a marketing Contact, which directly inverts #59's
  posture of holding as little there as possible and undoes the reasoning behind its
  Recipients' Data Erasure call. It also puts the onboarding copy in a UI outside version
  control.

**#59's lazy invite purge migrates onto this ticker** once it exists. `account-deletion.md`
Phase 1 puts the purge inside `CreateInvite` and `GetInvites` because there was nowhere
else to put it; that is a thing to move, not a precedent to follow. Not part of this
spec's phases — it is a follow-up once both have landed, and the lazy purge is correct
meanwhile.

### Timezone

Sends are at **10:00 local, falling back to `Europe/London`** when unknown. Mid-morning:
past the commute-and-triage window, so not buried under the overnight pile, and a grocery
app is a daytime thought.

`user.timezone`, a new `varchar(64)` holding an IANA zone name, populated from the browser's
`Intl.DateTimeFormat().resolvedOptions().timeZone` on the **existing** `POST /user` call —
`pages/index.tsx:166-170` already posts `{name, email}` there on every login, so this is
one more field on a payload that already exists and no new round trip.

**Insert-only, never updated.** `service.AddUser`'s `ON DUPLICATE KEY UPDATE` clause
refreshes `name`, `email` and `last_logged_in_at`; `timezone` is simply left out of it, so
the value is whatever was reported at signup and stays there. This costs nothing to
implement and buys the property that a fortnight abroad cannot scramble a fortnight-long
sequence. The cost accepted: the column is stale for anyone who genuinely relocates, which
for a sequence that ends on day 14 is close to irrelevant.

Storing an IANA zone is a new piece of personal data in our own database — coarse, but a
location signal. It goes no further than our database (it is never sent to SendGrid, GA or
Grafana) and `/privacy` names it.

Rejected: **rounding to a UTC offset** rather than keeping the zone name, on the grounds
that it holds less. It breaks across DST boundaries, so a sequence spanning late March or
late October sends an hour early or late — paying correctness for a reduction nobody asked
for.

### The send log, and what "sent" means

```sql
CREATE TABLE `email_send` (
  `user_id`  varchar(255) NOT NULL,
  `kind`     varchar(64)  NOT NULL,  -- 'welcome' | 'tips' | 'recipes' | 'feedback'
  `sent_at`  datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `kind`)
);
```

The composite primary key **is** the idempotency guarantee. A duplicate send is a primary
key violation rather than a second email, which is what makes the ticker safe to re-run by
hand and would catch a second machine if Fly ever scaled to two.

**The row is written on success only**, and the due-query uses `>=` on days-since-signup
rather than `=`:

```sql
-- due for `kind`, at 10:00 in their own zone, from a clean sequence
SELECT id, email FROM user
WHERE created_at >= <launch cutoff>
  AND timezone IS NOT NULL         -- or: fallback applied in the query
  AND DATEDIFF(NOW(), created_at) >= <n days for kind>
  AND id NOT IN (SELECT user_id FROM email_send WHERE kind = <kind>)
```

Together those two choices mean the sequence **self-heals**: a failed send, a deploy during
the send hour, or an outage does not skip an email — it arrives on the next day's tick.

**The guard that has to come with it:** at most one lifecycle email per User per tick. Do
not skip this. Without it, an outage lasting a week means the recovery tick finds a user
due for tips, recipes *and* feedback simultaneously and sends all three within a second of
each other, which is the single most likely way this design produces a spam report.

**A row means "handed to SendGrid", not "delivered", and not "read".** Unsubscribes are
suppressed by SendGrid after we make the call (see below), so a logged send may have been
dropped on their side. This is stated rather than solved because solving it means holding
unsubscribe state ourselves, which is the option rejected in the next section.

### Unsubscribe and suppression

**One SendGrid ASM (unsubscribe group), set on every lifecycle send.** SendGrid injects the
link, hosts the confirmation page, adds the `List-Unsubscribe` and `List-Unsubscribe-Post`
headers that Gmail and Yahoo look for, and suppresses future sends to that address itself.
No token to mint, no public page to build, no route to protect, no migration.

Beyond the saved work, it puts the fact in the right place. `account-deletion.md` already
decided that **SendGrid suppression entries are kept on erasure**, under the
legal-obligation basis — *"purging a spam report so you can lawfully mail someone again
inverts the point of the right."* Holding unsubscribe state in our own database would put
it inside the very cascade #59 deletes, so a user who deleted their Account and later
signed up with the same address would arrive unsubscribed-no-more. Keeping it in SendGrid
gets the correct behaviour for free: **the unsubscribe outlives the Account.**

`/privacy` has to say this — that the suppression list is permanent and is not erasable on
request. It is the conventional answer, but it is a carve-out from the erasure right and
it should not be discovered by someone reading the code.

Rejected: **our own token + `/unsubscribe` page + a column on `user`.** Full control, an
on-brand confirmation page, and a send log that could tell the truth about suppression.
But it needs an unguessable token that must not be derivable from the address, a public
Next.js page, a public API route and a migration — and SendGrid suppression is still
needed for bounces and spam reports, so it is the second system rather than the only one.
Also rejected, for the same reason plus two sources of truth that can disagree: doing both.

### Measurement

**No open pixel and no link rewriting.**

The pixel is the load-bearing refusal. A tracking pixel is precisely the thing that makes a
service email look like marketing, and ADR-0010's basis rests on these being service
messages — instrumenting them to see who read what argues against our own position. At
tens of users, open and click rates are also statistical noise that will be over-read.

SendGrid's delivery, bounce and spam-report events are kept, because suppression depends on
them and they are not behavioural surveillance of the recipient.

**Attribution is campaign-level `utm_*` parameters only**, on the links in the emails:

```
?utm_source=email&utm_medium=lifecycle&utm_campaign=welcome|tips|recipes|feedback
```

GA does campaign attribution natively from these, so **no new analytics event is added** —
which is what ADR-0008 §1 and `lib/analytics/events.ts` require (an event only when the
question needs more than Grafana's 14-day retention; otherwise it is a metric, and this is
neither).

Two constraints on those parameters:

1. **No user or account identifier, ever.** Not in a `utm_` value, not in a separate
   parameter. `account-deletion.md`'s GA4 section spends its length establishing that
   `account.id` must stop being a join key shared across Google, Grafana and our database,
   and replaces it with a UUID whose mapping table is the only place the link exists.
   Putting an identifier in an email link rebuilds exactly that linkage, in a URL, in a
   third party's logs.
2. **Attribution is undercounted by design.** GA does not fire without analytics consent
   (`lib/consent.ts`), so email-sourced sessions read low by whatever share declines. Know
   this before reading the numbers; do not "fix" it.

Links land on existing routes, so no new entry in `lib/analytics/page-titles.ts` is needed
— unless a dedicated landing page is added later, in which case the test that reads
`pages/` will say so.

### Templates and sender identity

**`html/template` files in the repo, `go:embed`ed.** Copy is reviewed in pull requests like
everything else, testable with golden files, one source of truth. A shared layout partial
carries the header, footer and the ASM unsubscribe tag so no individual template can omit
it.

Costs accepted: hand-written table-based HTML email, a local preview route to see it, and
a deploy for a typo fix.

Rejected: **SendGrid Dynamic Templates** — much nicer to iterate, preview and test-send,
but the onboarding sequence's actual words would live outside version control where they
cannot be code-reviewed, which runs against the whole documentation culture of this repo.
And **MJML compiled at build time**, which solves the table misery but adds a Node build
step to a Go service's pipeline plus a generated artefact that can drift from its source —
the repo already carries two `openapi.yaml`/`api.d.ts` drift checks for exactly that.

**One address, both directions: `hello@bigshop.life`**, with SPF and DKIM on the domain.
Every email Big Shop sends comes *from* it, and every reply lands *in* it. #50 is right
that this is one task and not several: #46 has to pick a verified sender and set the key
regardless, and settling it once here stops it being re-litigated per email type.

**No second mailbox, and no `Reply-To` header pointing anywhere else.** A separate
feedback address was the obvious alternative and is rejected: it doubles the number of
inboxes that have to be monitored to keep one promise, and the failure mode is silent —
mail arrives somewhere nobody has opened in a month, and the sender has no way to tell.
One address is also the honest shape for a product of this size. A recipient replying to
a Big Shop email should reach Big Shop, and there is only one of us.

A consequence worth stating because it is easy to get wrong later: the sending identity
and the receiving mailbox are the *same* account, so the address cannot be a send-only
alias or an unattended SendGrid identity. It has to be a real mailbox somebody opens.

The Day 14 email asks for a reply; asking for one and dropping it in a void is worse than
not asking.

### Trying it out before trusting it

The sequence is four emails spread over a fortnight, sent at 10:00 in the recipient's
morning. Taken literally, seeing the Day 14 email means waiting fourteen days, and seeing
a fix to it means waiting another fourteen. That is not a workable loop, and without a
deliberate answer the loop people actually use is "deploy it and watch the first real
signup", which tests the copy on a stranger.

So three mechanisms, each answering a different question. They are separate on purpose:
the fast one is not trustworthy about deliverability, and the trustworthy one is too slow
to iterate on.

**1. `go run . preview` — what does it look like?** A development-only HTTP route that
renders any template in the browser, with sample data, and reloads on edit. Registered
only when `DISABLE_AUTH=true`, so it cannot exist in production. Sends nothing, needs no
API key, and is the loop for writing copy and fixing table markup. It is also what makes
the "hand-written table-based HTML email" cost accepted above survivable.

What it cannot tell you: whether Gmail renders it the same way, whether it lands in the
inbox or in Promotions, or whether the unsubscribe link works — the substitution tag is
still a literal `<%asm_group_unsubscribe_raw_url%>` until SendGrid rewrites it.

**2. `go run . send-test --to=<address> --kind=<kind>` — does it survive a real mail
client?** Sends exactly one named email, immediately, to one address, through SendGrid,
with the real ASM group attached. This is the only way to answer the questions that
matter most and that no local tool can: inbox placement, how the layout degrades in
Gmail, Outlook and Apple Mail, whether SPF and DKIM align, and whether the unsubscribe
link actually resolves.

A subcommand rather than an HTTP route, and that is a security decision, not a stylistic
one. A route that sends mail to an address in its request body is an open relay wearing a
Big Shop badge, and the moment it exists somebody has to keep it authenticated. The binary
already dispatches on `os.Args[1]` (`serve`, `openapi`), so this is the established shape,
and it is reachable in production through `fly ssh console` without any of it being
exposed to the internet. Like `openapi` mode it returns early before the database is
opened — it renders and sends, and touches nothing else.

**It must never write an `email_send` row.** A test send is not a send to that user; the
send log is the idempotency guarantee for the real sequence, and polluting it means a real
user silently never receives the email you were testing. The `--to` address is also not
looked up, so testing does not require a User to exist.

**3. A backdated User — does the schedule work?** The one thing neither of the above
exercises is the part most likely to be wrong: the due-query, the timezone arithmetic and
the one-per-tick guard. Test that by inserting a User with a backdated `created_at`:

```sql
INSERT INTO user (id, name, email, timezone, created_at)
VALUES ('test|schedule', 'Schedule Test', '<an address you own>', 'Europe/London',
        NOW() - INTERVAL 8 DAY);
```

The next tick at 10:00 London should send that user exactly one email — the tips email,
not tips *and* recipes — and the tick after that should send nothing until the following
day. That is the guard and the self-healing `>=` query both demonstrated in one
observation. Go tests cover the same ground against an injected clock and are what CI
runs; this is the belt-and-braces check that the query really means what the tests assume.

**The trap that will bite whoever tests this first.** SendGrid suppression is permanent
and it is keyed on the address, not on the user. Click your own unsubscribe link while
testing and that address is suppressed for the whole ASM group — every subsequent test
send to it is accepted by the API, logged as a success, and silently delivered nowhere.
It looks exactly like a broken template. Two consequences:

- **Test the unsubscribe link last**, or test it with a `+suffix` address you are willing
  to burn.
- Know that the fix is to remove the entry under Suppressions in the SendGrid dashboard.
  This is the one place the permanence argued for above is inconvenient rather than
  correct, and it is worth the trade — see the unsubscribe section.

### When there is no key

**No `SENDGRID_API_KEY` means a clean no-op, never an error**, following the precedent
`account-deletion.md` Phase 3 sets for its erasure call. Today there is no key anywhere, so
this is the state everything ships into: the ticker runs, finds who is due, finds no key,
logs once and writes no `email_send` rows — so nothing is marked sent and the sequence
begins correctly the moment the key lands.

Note the trap `fly.toml:36-46` documents at length: under `machine_config`, a secret must
be **both** set with `fly secrets set` **and** declared in the `api` container's `secrets`
array, or it is simply absent at runtime with nothing reporting a problem.

### The welcome email is the one exception to the ticker

It is sent inline on the request that creates the User, because a welcome email arriving
the next morning is a broken welcome.

**Fire-and-forget: it must never fail the request.** This is precisely the mistake
`POST /invite` makes today — #46 records that a send failure returns 400 while the invite
row it already wrote survives — and the mistake `account-deletion.md` is fixing by
degrading that call to 200. Do not rebuild it here. The User is created; the email is a
courtesy on top.

It still writes to `email_send`, so the ticker never re-sends it, and so a failed welcome
is retried by the ticker on the next day's tick like any other.

## Phase 2 — the transactional family

Deliberately a separate implementation phase. Two of the three items need Auth0 dashboard
access, which is not something the lifecycle work should wait on.

### The Auth0 tenant audit

#50 framed this as hygiene. It is now a **dependency of work already in flight**:
`specs/completed/account-deletion.md`'s Open Question 2 says *"Auth0 tenant configuration for the
Management API client is unspecced here; #50's audit of the tenant is the natural place to
settle it, and Phase 3 is the first thing that needs it."*

So the audit settles two things at once. What to check:

- **Which connections are enabled.** If the tenant is social-only there is no
  forgotten-password flow to fix at all, and a chunk of the presumed transactional family
  evaporates. This also decides an open question in `account-deletion.md`, which notes that
  a re-signup yields the same subject for `google-oauth2|…` identities and a new random one
  for database identities.
- **Whether the Change Password, Verification and Blocked Account templates are still
  Auth0 defaults.** They are unbranded and say "Auth0" to a user who has never heard of it.
- **Whether the tenant still sends via Auth0's shared dev mail provider**, which is
  rate-limited and explicitly not for production. The tenant is `dev-x-n37k6b.eu.auth0.com`
  — the `dev-` prefix is Auth0's own default naming, which is consistent with nothing
  having been changed.
- **The machine-to-machine client** for the Management API that `account-deletion.md`
  Phase 3 needs, plus the Fly secret it implies.

**Then point Auth0 at SendGrid**, so every email Big Shop causes to be sent leaves from one
verified `bigshop.life` sender with one SPF/DKIM alignment. Auth0 supports SendGrid as a
custom email provider directly. Without this there are two sending systems with two
identities and one of them is rate-limited.

### The Account deletion confirmation

`account-deletion.md` disowned this deliberately, to break a two-way deadlock: deletion
works end to end sending zero emails, so a confirmation is purely additive.

**It has exactly one correct position** in that spec's five-step sequence: **after step 1
(soft-gate), before step 2 (SendGrid erasure).**

- After step 1, because the soft gate is the moment the request is actually honoured.
- Before step 2, because step 2 calls SendGrid's Recipients' Data Erasure API for that
  address. Sending afterwards would re-create in SendGrid the recipient data that step had
  just erased — an email that undoes the erasure it is confirming.
- It inherits step 2's ordering constraint for the same reason step 2 has it: **read
  `user.email` before step 5 destroys the row.**

Best-effort, like everything else between the gate and the hard delete. A failed
confirmation email must not abort a deletion.

### Invite accepted — tell the inviter

Today someone shares their Account, the invitee joins, and the inviter finds out by
noticing. A two-line email closes the loop on the product's strongest retention feature.

**Sequenced after #59 merges.** `account-deletion.md` Phase 1 and #46 both own parts of
`service/invite.go` and `app/invites.go` right now — the HMAC digest, the lazy purge, the
400-to-200 degrade. A third change to the same handlers for a third reason is how two
agents collide.

**This one email goes to the inviter, whose address we still hold in plaintext on `user`.**
It cannot be generalised into anything invite-shaped in the other direction: `invite.email`
is an HMAC digest with no plaintext retained past the sending request, so **invites can
never be resent**. If a general resend capability is ever wanted, invites are the permanent
exception, and this is the note that says why.

## Implementation sequence

Ordered so each phase ships on its own and none is rework for a later one.

### Phase 1a — the sending seam

- A `service/email` package: one `Send(ctx, to, subject, template, data)` entry point, the
  ASM group id set on every message, the clean skip when `SENDGRID_API_KEY` is unset.
- The embedded layout partial and a golden-file test for it.
- Port `inviteUser`'s inline send onto it — same behaviour, one place. Coordinate with #46,
  which is changing that call's error handling for its own reasons.

No scheduler, no new tables, no new emails. Ships alone and makes every later phase small.

*Done when:* the invite email is sent through the seam, the Go tests pass with no key
present, and `POST /invite` behaves exactly as #46 leaves it.

### Phase 1b — timezone capture

- Migration: `ALTER TABLE user ADD COLUMN timezone varchar(64) NULL`.
- `common.User` gains `Timezone string \`json:"timezone,omitempty"\`` — `omitempty` for the
  reason `types.go:140-144` already gives for `Onboarded`: it is never sent as input on
  `POST /invite`, and Huma would otherwise mark it required on that body.
- `service.AddUser` writes it on insert and **omits it from the `ON DUPLICATE KEY UPDATE`
  clause**.
- `pages/index.tsx` adds `Intl.DateTimeFormat().resolvedOptions().timeZone` to the existing
  `POST /user` payload.

Ships before anything needs it, so the column is populating for real users while the rest
is built.

*Done when:* a fresh login records a zone, a second login does not change it, and a null
zone is handled everywhere it is read.

### Phase 1c — the ticker and the send log

- Migration: `email_send`.
- The hourly ticker, started from the serve path only — **not** from the Lambda path, which
  would start one per invocation.
- The due-query, the one-email-per-user-per-tick guard, and the launch cutoff constant.
- Go tests for the due-query across timezone and cutoff boundaries, and for the guard.

No templates yet: this phase can be proven with a stub that logs instead of sending.

*Done when:* the ticker selects the right users at the right local hour, never selects the
same (user, kind) twice, and never selects more than one kind per user per tick.

### Phase 1d — the four emails

- Four templates, the `utm_*` links, the non-promotional constraint stated in the templates
  themselves.
- `preview` and `send-test` modes, per "Trying it out before trusting it" above. They land
  here rather than earlier because both need templates to be worth having, and `send-test`
  is what proves the whole chain — key, sender, SPF/DKIM, ASM group — before a real signup
  is the thing that tests it.
- The welcome email's inline fire-and-forget send in `addUser`.
- `/privacy`: the lifecycle family, its lawful basis, the permanent suppression list, and
  `user.timezone`.
- The SendGrid ASM group created, the sender verified, SPF/DKIM set, and
  `hello@bigshop.life` monitored as a real mailbox that receives as well as sends.

*Done when:* all four render correctly in a real mail client via `send-test`, a real signup
receives a welcome immediately, a backdated User receives exactly one email on the next
tick, and unsubscribing from any one of them stops the rest.

### Phase 2 — transactional

The Auth0 audit first (it unblocks `account-deletion.md` Phase 3), then the deletion
confirmation, then the invite-accepted notification once #59 and #46 have merged.

## What this spec does not do

- **No weekly-rhythm or win-back email.** Both were considered and put out of scope: the
  weekly "plan your shop" email presumes activation already worked, and win-back is the
  lowest-yield family and the hardest to write well.
- **No broadcast mechanism.** Send-to-a-list-once is a different thing from send-on-a-
  schedule, and the only thing that wants it is the existing-user email on its own board
  row.
- **No re-sending of invites**, permanently, per above.
- **No preference centre.** Unsubscribe is all-or-nothing for the lifecycle family;
  transactional email is not unsubscribable and should not be. Four emails over a fortnight
  do not justify per-category preferences.

## Open questions

1. **Whether the address column is any good.** `user.email` has never been checked for
   completeness or validity. The design degrades safely — a null or malformed address is a
   skip — but the first week of bounce events is real information and nobody has looked at
   it yet.
2. **What the Day 8 email's recipes actually are, and who owns them.** The same question
   #42 raises for seeding a new Account with sample Recipes, and it should get the same
   answer rather than a second one. #42 notes the interaction with the Global Ingredient
   Catalog: whatever is chosen should use well-curated Ingredients rather than introducing
   new ones.
