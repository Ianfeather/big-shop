# Account deletion, and the right of erasure

Implements the [bigshop board](https://app.notion.com/p/87fae8a2ed054f2c874201e827639bd8)'s
**#59 — There is no way to delete an Account, and GDPR requires one**. Extends
[ADR-0008](../docs/adr/0008-what-telemetry-does-not-carry.md) §1 and amends
`migrations/034_consent_event.sql`. Carries constraints into **#46** (invite flow)
and **#50** (email), both of which have been updated to say so.

The framing #59 sets and this spec keeps: **the hard part is not the SQL.** Right of
erasure is not optional and has no partial version, but "delete my account" is genuinely
ambiguous in a product whose reason to exist is that an Account can be shared. Everything
below flows from settling that ambiguity first and the mechanics second.

Two things this spec deliberately does **not** do, both decided on the board:

- **It sends no email.** A deletion-confirmation email belongs to #50's transactional
  family. Making it a prerequisite here would deadlock: #50's transactional work wants
  #59's deletion flow to hang off, while #59 would be waiting for #50. Deletion works end
  to end with zero mail; a confirmation is additive whenever it arrives.
- **It does not fix `POST /invite/reject`'s missing caller scoping.** That is #46's, and
  it stays #46's, so the two items do not collide on the same handler for different
  reasons.

## Current state

Genuinely absent:

- **No deletion of anything account-shaped.** Nothing deletes a `user` row, an `account`
  row, or anything in Auth0. There is no route, no service function, no runbook. A user
  who asks to be deleted today can only be served by hand against production.
- **No GA identifier mapping table.** `lib/analytics/ga.ts:254`'s `setAccount` sends the
  raw `account_id` as a GA user property.

Present, and load-bearing for the design:

- **`service.DisableUserAccount` (`service/account.go:99`) is the closest thing to a
  deactivation, and it is broken.** It sets `account_user.enabled = false` for **every**
  row matching a user, with no account scoping. Since `GetAccountID`/`GetAccount` both
  filter `enabled = true`, its victim is left able to log in and resolve to no Account at
  all. Its one caller is not user-facing: `app/invites.go:36`, disabling an invitee's old
  Account when they accept an invite elsewhere. Phase 2 fixes the scoping, because this
  spec turns it into the soft gate.
- **`account_user.enabled` already exists** (`migrations/009_invites.sql`) and is already
  filtered on in the read path. The soft gate is therefore nearly free — no new column, no
  new predicate threaded through every query.
- **`service.DeleteRecipe` already encodes the correct recipe cascade** — `part` →
  `recipe_tag` → `list` → `shopping_list_event` → `recipe` — with a comment explaining why
  `shopping_list_event` must go before `recipe` (migration 015's foreign key). **It runs
  outside a transaction**, using `db.ExecContext` directly, so a mid-cascade failure leaves
  a recipe stripped of its parts. Phase 0 fixes that as a side effect of reusing it.
- **`consent_event` has a foreign key to `user.id`** and a header comment reading *"INSERT
  only. Never UPDATE, never DELETE."* Both matter — see "`consent_event`" below.
- **`user.email` is plaintext `varchar(255)`** (`migrations/006_user.sql:4`), upserted on
  every login by `service.AddUser`. This is what makes the SendGrid erasure call possible
  at all.
- **The Global Ingredient Catalog is deliberately shared** and must not be touched, per
  [ADR-0001](../docs/adr/0001-global-ingredient-catalog.md). Ingredient names coined during
  someone's imports are global, are not personal data, and erasing them would damage every
  other Account. Stated here because a thorough implementer will go looking for "their"
  ingredients and must be told, explicitly, to leave them alone. The same goes for `tag`
  and `unit`.

## Two deletions, not one

Per [CONTEXT.md](../CONTEXT.md) a Recipe belongs to an **Account**, not a User, and an
Account can have several Users. The board settled the product question on 2026-08-17:

> **Recipes remain with the Account when a User departs, provided the Account is shared
> with at least one other User.** The unambiguous case is unchanged: the last User of an
> Account leaving means the Account and everything under it goes.

So one user-facing action, "delete my account", resolves to **two different operations**,
chosen by counting the Account's remaining enabled members:

| | Sole member | Shared with others |
|---|---|---|
| `recipe`, `part`, `recipe_tag`, `list`, `shopping_list_event` | deleted | **kept** — they are the Account's |
| `account` row | deleted | kept |
| `account_user` row for this user | deleted | deleted |
| `invite` rows sent *by* the Account | deleted | **kept** — the Account still exists |
| `invite` rows addressed *to* this user | deleted | deleted |
| `user` row, Auth0 identity, GA mapping, SendGrid | deleted | deleted |

The right-hand column is the one to get right: the departing user is erased completely,
while the Account they contributed to carries on. Nothing about the shared case leaves
their personal data behind — their Auth0 subject, name and email all go. What stays is
Recipe content, which is the Account's.

**This has to be stated in the invite terms, not merely implemented.** A user accepting an
invite is the moment they need to understand that Recipes they contribute become the
Account's and outlive their departure. That copy is #46's to write into the invite flow;
this spec's obligation is that `/privacy` agrees with it (Phase 5).

## `consent_event` — the rows are deleted. Resolved 2026-08-18.

**Two decisions already on #59 could not both hold as written**, and the resolution
reverses one of them. The board said keep `consent_event` (it proves the processing was
lawful, and destroying that evidence to satisfy an erasure request is the wrong trade) and
also said hard-delete the user. But `consent_event.user_id` carries
`CONSTRAINT fk_consent_event_user_id FOREIGN KEY (user_id) REFERENCES user (id)`, so
deleting the `user` row with its consent rows still present fails outright.

**Decided: `DELETE FROM consent_event WHERE user_id = ?`, inside the deletion
transaction, before the `user` row goes.**

The argument that settles it is that **severing the link destroys the very thing the
retention was for.** The board kept these rows to preserve proof that *a specific person*
consented. Break the link to that person — by any mechanism — and what survives says
"somebody consented on this date, under this policy version, via the banner", which rebuts
nothing if an ex-user later claims they were tracked without consent. So delinking does not
serve the principle that motivated keeping the row; it only pays schema complexity to
retain something inert. The legal shape agrees: the UK GDPR Article 7(1) duty to
demonstrate consent runs for data subjects whose data you process, and after erasure you
process none of theirs.

Three delinking schemes were considered and all fail for the same reason:

- **A peppered HMAC of `user_id`** was the original recommendation here and is withdrawn.
  Its justification was that a disputing ex-user could identify themselves and we could
  recompute the digest to find their row — but that requires re-obtaining their Auth0
  subject, which the deletion has just destroyed. It happens to work for social identities
  (`google-oauth2|…` carries a provider-stable id, so a re-signup yields the same subject)
  and fails for database identities (a new random subject). #50 records that nobody has
  audited which connections the tenant even has enabled, so the scheme would work for an
  unknown fraction of users by accident of connection type. It also leaves a column holding
  Auth0 subjects in some rows and hex digests in others with nothing marking which.
- **The GA UUID mapping-table pattern does not transfer.** That pattern exists because
  *Google* holds data we cannot delete, and severing the link is the only lever we have
  over someone else's database. `consent_event` is our own table with no external copy
  being stranded, so a mapping table would produce an outcome identical to nulling the
  column, via an extra table and an extra join.
- **Nulling `user_id`** is the honest minimum of the above, and is rejected for the same
  reason as the rest: an inert row is not evidence.

Retaining a **tombstone `user` row** was also rejected. It satisfies the foreign key, but
keeps the Auth0 subject in plaintext for somebody we have just told we erased.

**This needs no schema change at all** — no dropped foreign key, no new column, no
migration. Deleting children before the parent is what the constraint is for. It does
contradict `migrations/034_consent_event.sql`'s header, which says "INSERT only. Never
UPDATE, never DELETE", so **that comment must be amended in the same change**: the
append-only guarantee is about never rewriting a decision that was made, and it stands.
Erasing a person entirely is a different act, and the comment should say which one it is
ruling out.

## Decisions carried in from the board

Settled on #59; restated here so the spec is readable on its own.

**Auth0 — delete.** A working login for a deleted account is the failure this item was
raised for.

**Telemetry / Grafana — ignore, but document.** 14-day retention on the free tier is
accepted as sufficient; no deletion path is built. The point of the decision is that
expiry is the mechanism, so `/privacy` must say so rather than leave it unwritten.

**GA4 — a UUID mapping table.** Google's `submitUserDeletion` accepts only `userId`,
`clientId`, `appInstanceId` and `userProvidedData`; a custom user property is not among
them, and `ga.ts:254` deliberately sends `account_id` as a user property and never as
`user_id`. So the API is unusable, and the answer is to send a random UUID instead, held
in a mapping table whose row deletion severs the link. Three things must be built in
rather than assumed: it **severs a link and deletes nothing in GA**; "GA becomes anonymous"
is true only of *our* identifier, since Google keeps its own `_ga` client ID and
IP-derived geo regardless; and the real justification is **unlinkability, not deletion** —
what the UUID buys is that `account.id` stops being the same join key across Google,
Grafana and our own database. That makes the mapping table the only place the link exists,
backups and logs included.

**SendGrid — call the Recipients' Data Erasure API**, skipping cleanly when no key is
configured. It is a `DELETE` by address, up to 5,000 per call, enabled by default for
SendGrid accounts created after 2023-07-25. SendGrid also expires recipient personal data
at 37 days regardless, which is the backstop that lets our call be best-effort. This
follows the Auth0 precedent rather than the Grafana one — Grafana's "rely on expiry" was
forced by there being no deletion path; declining an available one is a different choice
and a harder one to defend.

**SendGrid suppression entries — keep**, under the legal-obligation basis. Purging a spam
report so you can lawfully mail someone again inverts the point of the right.

**Global Ingredient Catalog — untouched**, per ADR-0001.

## The invite table

The live exposure #59 under-weighted. `service/invite.go` deletes a row on accept and on
reject, and **nothing deletes it on expiry** — `GetInvites` merely filters `expires > ?`.
Every address ever typed into the invite box is still in the database, indefinitely,
including addresses of people who never signed up, never consented, and have no Account to
delete.

**`invite.email` becomes `HMAC-SHA256(lowercased, trimmed address, pepper)`.** Every read
of the column is an equality match against the caller's own `user.Email` (`invites.go:30`,
`:45`, `:59`) and the plaintext is never read back out, so the digest breaks no existing
path. Existing rows backfill in place, since we still hold the plaintext. A 64-character
hex digest fits `varchar(255)` and the `(account, email)` primary key with no schema
change.

A plain SHA-256 was rejected: the email address space is enumerable, so anyone holding a
database dump could confirm whether a specific named person had been invited by hashing
their address and grepping. The pepper is a Fly secret (`INVITE_EMAIL_PEPPER`), read the
same way `SENDGRID_API_KEY` is, defaulting to empty in dev and e2e — which degrades to a
plain digest, deterministically per environment.

**Expired rows are purged lazily**, inside `CreateInvite` and `GetInvites`, because there
is no scheduler in this architecture and inventing one for a single `DELETE` is
disproportionate. `GetInvites` runs on every account-page load, so the purge stays timely;
the table is tiny, so the write on a read path is noise. A consequence worth naming: the
table is never more than ~30 days deep, so **a pepper rotation self-heals within a month**
rather than being a one-way door.

**No resend, ever.** The row is written (hashed) first, then the send attempted, and a send
failure degrades to **200**. This preserves the benign failure #46 identified — *"an
invitee never actually needs the email; logging in is enough for the card to appear"* — so
the invite row is the durable artefact and the mail is a courtesy on top of it. Sending
first was rejected: a database failure after a successful send leaves the invitee holding
an email for an invite that does not exist, which is the worse failure. The 400-to-200
change is #46's to make, but this spec depends on it, and #46 has been told.

**A limitation, stated rather than discovered later.** Hashing forecloses third-party
SendGrid erasure. We can call the erasure API for the *deleting user*, because `user.email`
is plaintext — with an ordering constraint Phase 3 carries: **read it before deleting the
`user` row.** We can never call it for people they invited, because we no longer hold those
addresses. Their backstop is SendGrid's 37-day expiry. That is defensible, and it is not an
oversight.

## Sequencing across four systems

The flow touches the database, Auth0, SendGrid and the GA mapping table, with no
distributed transaction and no scheduler to retry with. The two bad outcomes are
asymmetric: **Auth0 survives but the database is gone** gives a working login resolving to
nothing, which is precisely the failure #59 exists to fix; **the database survives but
Auth0 is gone** gives orphaned rows the user can no longer reach in order to retry.

```
1. Soft-gate       account_user.enabled = false, scoped to (user, account).
                   The account is unreachable from this instant, which is what
                   the user actually asked for. Everything after it is cleanup.
2. SendGrid        Best-effort. Log and continue on failure; 37-day expiry is
                   the backstop. Reads user.email BEFORE step 5 destroys it.
3. GA mapping      Delete the UUID row. Best-effort, same reasoning.
4. Auth0           HARD GATE. On failure, abort and return an error. Nothing
                   irreversible has happened yet, so the user can retry.
5. Hard delete     One transaction. Cascade below.
```

Any failure leaves a **gated, retryable Account** rather than a half-deleted one. That is
the whole reason the soft gate leads rather than trails: it makes every subsequent step
idempotent-ish and safe to re-run by hand.

Fixing `DisableUserAccount`'s missing account scoping is owed regardless — #59 lists it as
a live bug — so step 1 is not new work invented by this design.

## One cascade, not several

**The main way to build this system twice is to write a second delete cascade.** There is
already one, in `DeleteRecipe`, encoding a non-obvious order and a foreign key that bites.
Account deletion needs the same order over a whole account, and the tempting shapes are
both wrong: looping `DeleteRecipe` over every recipe is N× the queries and still leaves
`list`/`shopping_list_event` rows not tied to a recipe; hand-writing a parallel
account-scoped cascade means two orderings that must be kept in sync forever, and the
second one will drift the first time a table is added.

**So: one set-based primitive, two entry points.**

```go
// deleteRecipeData removes everything hanging off a set of Recipes, in the one
// order that satisfies the foreign keys. It is the only place that order lives.
//
// recipeIDs == nil means "every Recipe in the account", which is what account
// deletion wants and what keeps this from being run in a loop.
func deleteRecipeData(ctx context.Context, tx *sql.Tx, accountID int, recipeIDs []int) error
```

`DeleteRecipe` becomes a one-recipe caller of it, and gains a transaction it should always
have had. `DeleteAccount` calls it once with `nil`. Adding a recipe-scoped table later
means editing one function, and both callers are correct by construction.

The account cascade, inside a single transaction:

```
deleteRecipeData(tx, accountID, nil)     -- part, recipe_tag, list,
                                            shopping_list_event, recipe
DELETE FROM list                 WHERE account_id = ?   -- Extra Items: no recipe_id,
                                                           so not covered above
DELETE FROM shopping_list_event  WHERE account_id = ?   -- likewise
DELETE FROM invite               WHERE account = ?      -- sent by this Account
DELETE FROM invite               WHERE email = <digest> -- addressed to this user,
                                                           across ALL accounts
DELETE FROM ga_account_uuid      WHERE account_id = ?
DELETE FROM consent_event        WHERE user_id = ?      -- before `user`; see above
DELETE FROM account_user         WHERE user_id = ? AND account_id = ?
DELETE FROM user                 WHERE id = ?
DELETE FROM account              WHERE id = ?
```

In the **shared** case, every statement from `DELETE FROM list` down to
`DELETE FROM invite WHERE account = ?` is skipped, along with the final
`DELETE FROM account` — the Account and its content survive; the person does not.

Never touched, at any point: `ingredient`, `unit`, `tag`, `department`,
`ingredient_department`, `ingredient_unit_size`.

## Implementation sequence

Ordered so that **each phase ships on its own, is independently valuable, and none is
rework for a later one.** Phases 0 and 1 deliver real privacy improvements before any
deletion route exists, which matters because they are the parts covering people who are
not our users.

### Phase 0 — the cascade primitive

Extract `deleteRecipeData` from `DeleteRecipe`; make it set-based and transactional.

No new tables, no new routes, no behaviour change. The existing e2e recipe-delete coverage
proves it. Ships first because everything downstream calls it, and because merging it alone
keeps the diff that changes *behaviour* small enough to review.

*Done when:* `DeleteRecipe` is a thin caller, the whole cascade is in one transaction, and
`e2e/recipe.spec.ts` is untouched and green.

### Phase 1 — invite hardening

Entirely independent of account deletion, shippable immediately, and the cheapest privacy
win available.

- Migration: backfill `UPDATE invite SET email = <HMAC of existing plaintext>`. Requires
  the pepper to exist first, so **set `INVITE_EMAIL_PEPPER` on Fly before deploying** — a
  backfill run against an empty pepper produces plain digests that the peppered read path
  will never match, silently orphaning every live invite. Not fatal (they expire in 30
  days) but avoidable.
- A `service.HashEmail` helper — the single place the digest is computed, since the
  deletion cascade in Phase 2 reuses it to find invites addressed to the departing user.
- Hash at every call site: `CreateInvite`, `GetInvites`, `GetInvite`, `DeleteInvite`.
- Lazy purge in `CreateInvite` and `GetInvites`.
- `/privacy`: invite retention and hashing.

*Done when:* invites still work end to end (`e2e/` covers accept/reject via the card), no
plaintext address remains in `invite`, and an expired row disappears on the next
account-page load.

### Phase 2 — the deletion service, database only

- Fix `DisableUserAccount`'s account scoping. Check `app/invites.go:36` still behaves —
  it is the existing caller and its intent ("disable the invitee's *old* account") is
  actually better served by the scoped version.
- `service.DeleteAccount(ctx, tx, caller)`: member-count branch, both cascades, wired to
  Phase 0's primitive.
- `DELETE FROM consent_event WHERE user_id = ?`, ordered before the `user` row so the
  foreign key is satisfied rather than dropped. **Amend `migrations/034_consent_event.sql`'s
  header comment in the same change** — it currently says "Never UPDATE, never DELETE" and
  addresses a note to whoever implements this item. Replace that note with what was actually
  decided and why, so the next reader finds the answer where they were told to look.
- Go tests for both branches, and for the invites-in-both-directions rule.

No route yet, no external calls. This is the piece worth getting wrong in private.

*Done when:* Go tests cover sole-member and shared-member deletion, assert that a shared
Account's recipes survive, and assert that deleting a user with consent history does not
trip the foreign key.

### Phase 3 — external systems

- Auth0 Management API delete, as the hard gate. Needs a machine-to-machine client and a
  new Fly secret.
- SendGrid Recipients' Data Erasure call, best-effort, **reading `user.email` before the
  transaction**, and a clean skip when `SENDGRID_API_KEY` is unset — which is today, and
  which must stay a no-op rather than an error until #46 sets it.
- The orchestrator implementing the five-step sequence above.

*Done when:* deletion runs correctly with no SendGrid key present, and the Auth0 failure
path aborts without having destroyed anything.

### Phase 4 — the GA mapping table

- Migration: `ga_account_uuid (account_id, uuid)`.
- `ga.ts:254` sends the UUID instead of `account_id`. Existing accounts get a UUID on
  first read.
- Wired into the cascade.

Deliberately late: it is the only phase that changes what production analytics reports, and
it is the one whose benefit is an argument about unlinkability rather than a deletion.

### Phase 5 — the route, the UI, and the policy

- `DELETE /account`, registered in `app/account.go`.
- Account-page UI with a confirmation step that **names which of the two outcomes will
  happen** — "your recipes will be deleted" versus "your recipes stay with the account you
  share with N others" — since the difference is invisible otherwise and is the thing users
  will be angriest about getting wrong.
- `/privacy`: SendGrid erasure and its suppression carve-out; Grafana's 14-day expiry as
  the stated mechanism; the GA UUID described as unlinkability, not deletion.
- e2e coverage. Note the constraint in CLAUDE.md: a spec touching the Shopping List must
  not run alongside `shopping-list.spec.ts`, and deletion touches `list`. Assert on API
  responses rather than on rendered list state, as `recipe-import.spec.ts` does.

*Done when:* a user can delete their own account from the UI, both branches behave, and
`/privacy` describes what actually happens.

### Cleaning up existing accounts

The reason the sequence lands on **one** service function rather than an admin script:
after Phase 3, `service.DeleteAccount` is the only correct way to remove an Account, and
bulk cleanup of abandoned or test accounts is a loop over it rather than a second
implementation. A `cleanup-accounts` subcommand on the existing Go binary (which already
has `serve`) is the natural home if one is ever wanted — reusing the same path, so the
externals and the cascade cannot drift from the user-facing route.

Nothing in this spec should produce a hand-written `DELETE` against production. If one
seems necessary, that is a gap in `DeleteAccount`, and the fix belongs there.

## Open questions

1. **Data export (right of access)** is the same underlying question — what belongs to this
   person — answered in the other direction. #59 notes the two are best designed together.
   This spec does not cover it, and Phase 2's member-count branch is the piece an export
   would reuse.
2. **Auth0 tenant configuration** for the Management API client is unspecced here; #50's
   audit of the tenant is the natural place to settle it, and Phase 3 is the first thing
   that needs it.
