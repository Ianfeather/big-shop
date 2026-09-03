# Getting back to your recipes after signing in a new way

Spun out of the [bigshop board](https://app.notion.com/p/87fae8a2ed054f2c874201e827639bd8)'s
**Offer more social login options than Google**, which shipped the machinery this
depends on: `user_identity` (`migrations/043`) aliases a person's several Auth0
subjects to one `user.id`, and `service.LinkOrCreateIdentity` links a new subject
to an existing person **when the verified email matches**.

This spec is for the people that last clause misses.

**Status:** spec only. Nothing built. Design settled 2026-09-02 in conversation;
the security argument in "Why not an emailed link" is the substance of it and is
the part worth disagreeing with if you are going to disagree with any of it.

Two things it deliberately does **not** do:

- **It does not prevent the problem.** An affected person still lands in an empty
  account first and has to notice. Prevention — offering "add another sign-in
  method" from `/account` *before* it is needed — is the better feature and is
  explicitly out of scope, because it helps nobody who is already stuck.
- **It does not unlink.** There is no way to undo a link, and `/account` gains no
  sign-in-methods panel. Reasoning under "Rejected: unlinking".

## Current state

Signing in with a second provider works today, silently and correctly, **provided
the second provider hands over the same verified email address.** When it does
not, `LinkOrCreateIdentity` reaches case 3 and does exactly what it does for a
stranger: a `user` row, a `user_identity` row, an `account`, an `account_user`.
The person is signed in, the app works perfectly, and every recipe they own is
invisible.

Nothing is wrong from the server's point of view. There is no error, no warning
and no signal anywhere that distinguishes this person from someone who genuinely
signed up thirty seconds ago — because at the level of the data, there isn't one.

**Two populations reach it**, and only the first is usually discussed:

- **Apple Private Relay.** "Hide My Email" hands over
  `…@privaterelay.appleid.com` (and now `private.icloud.com` — see Apple's
  [domain note](https://developer.apple.com/news/?id=sus6t6ab)). It is stable per
  Apple ID per developer team, so it is a perfectly good key for *that* identity,
  and it will never match anything else. Unfixable at the matching layer by
  anyone, including Auth0.
- **A different address at the same person.** Signed up with a personal Gmail,
  later signs in with Microsoft as a work address. Both verified, both genuinely
  theirs, neither equal to the other.

The second is the larger group and the one that gets forgotten. A mechanism built
for relay covers both, which is most of why this is worth building at all.

## Why not an emailed link

The obvious design — and the one this spec started as — is: let them type the
address they think they used, send a confirmation email, and link when they click
it.

**It is an authorisation grant wearing an email verification.** Google signup is
open to anyone. So an attacker signs up in ten seconds, types
`victim@example.com`, and Big Shop sends that person an unsolicited "confirm this
is your account" email. If they click it — from confusion, habit, or curiosity —
the attacker's identity is permanently bonded to their account, with full read
and write access to their recipes and shopping list. The victim did nothing wrong
except trust a message we sent them.

Two things make this worse than it first looks. The email is *from us*, so it
carries our credibility rather than an attacker's. And the person receiving it has
no context at all — they did not initiate anything, so nothing they know can help
them judge it.

**Auth0's own tooling refuses to do this.** The Account Link Extension will not
auto-link even when both addresses are verified, and instead makes the user
re-authenticate with the original provider. Their stated reasoning is that a
verified address proves you *once* controlled it, not that you control it now.
Any design here that is weaker than the thing Auth0 ships as its safe default
needs a very good argument, and "it is simpler" is not one.

**And it is unnecessary**, which is the part that settles it. The person is
sitting in front of the application. They can prove they own the other account
the strongest way available: by signing into it. Proving ownership was never the
hard part — telling them that is what to do is.

## The flow

1. Someone signs in with a provider whose address does not match. They get an
   empty account, exactly as now. Nothing about `LinkOrCreateIdentity` changes.
2. They land on `/list` (`lib/app-origin.ts`'s `loginRedirectUri`). When the
   recipes query has **resolved** and returned nothing, the page offers:
   *"Expected to see your recipes here? Link an existing account."*
3. Clicking it writes a nonce to `localStorage` and calls `POST /link/start`,
   which returns a short-lived, single-use token bound to `caller.Subject`.
4. The browser redirects to Auth0 with `prompt=login`, so the existing session
   cannot be silently reused and they must actively authenticate.
5. They sign in as their **original** identity and return to `/link/confirm`.
6. That page states plainly what is about to happen — *"You are about to let your
   Apple sign-in reach this account"* — and writes nothing until they accept.
7. `POST /link/complete` verifies the token, the nonce, and that the source
   account is empty; writes the `user_identity` row; and erases the abandoned
   account's rows.
8. An informational email goes to the original account's address saying a new
   sign-in method was added.

### Why the nonce

Choosing re-authentication removes the unsolicited email. It does **not** remove
the transferable grant, and this is easy to miss.

Without a browser binding, the attacker starts a link as themselves, then sends
the return URL to the victim — "here's that recipe I mentioned". The victim
clicks, is asked to sign in, which looks completely normal, signs in as
themselves, and returns holding *the attacker's* link token. We bond the
attacker's identity to the victim's account. Re-authentication proved the victim
owns the account; it never proved that the person who *started* the link is the
person who *finished* it.

A nonce in `localStorage`, required at completion, makes the grant
non-transferable: a URL pasted into another browser has nothing to match and is
inert. It is the ordinary CSRF state defence, applied to the right thing.

**It survives the PWA and the future native wrapper**, which is worth stating
because it looks like it might not. `specs/native-app-wrapper.md` §4 is explicit
that login must *not* run in the embedded webview — it hands off to
`ASWebAuthenticationSession` / Custom Tabs and **deep-links back into the app**.
So the app writes the nonce in its own origin, delegates only the
*authentication*, and regains control in the same context with its storage
intact. On the installed PWA the callback returns to `/list`, inside scope; the
board item *"Open the installed PWA on /list, including after logging in"* is
evidence that round trip already works.

And the failure direction is the safe one. If some untested platform does lose
the nonce, the link **does not complete** — the person retries, or does it on the
web. A usability cost, not a hole.

Rejected: a 6-digit pairing code shown at step 3 and typed at step 6. It is
storage-independent by construction and immune to any browser-partitioning
surprise, but it puts a copy-a-code step in the middle of a flow the person is
already confused by, to defend against a scenario the section above suggests does
not arise.

## The abandoned account

By step 7 the person already has a full account: `user`, `user_identity`,
`account`, `account_user`, a `ga_account_uuid`, a consent event, and possibly a
welcome email logged in `email_send`. Linking does not create anything — it
**abandons** all of that. The subject stops pointing at it and nothing can ever
reach it again.

An orphaned `account` row with no reachable member is precisely the state
`OtherAccountMembers` and the deletion cascade were written to avoid. Leaving
them behind means seeding the database with the shape the last round of work
spent its time keeping out.

**So the link is refused if the source account holds any recipes.** Merging two
populated accounts is a different and much larger problem — duplicate recipes,
two shopping lists, two sets of invites, the Global Catalog's ingredient lines —
and it is not what anybody in this situation is asking for. An empty library is
the first thing you notice, so the population who add recipes *before* noticing
is small; they get a clear message and a support address.

### Use `deleteAccountTx`, not `DeleteUserAndAccount`

**This is the trap in the whole spec.** `DeleteUserAndAccount` is the five-step
erasure sequence, and three of its steps are actively wrong here:

- it sends a deletion-confirmation email, to somebody who did not delete anything;
- it erases the SendGrid recipient for that address;
- **it deletes the Auth0 identity** — which is the very subject just linked.

What is wanted is the inner `deleteAccountTx` cascade: the database rows and
nothing external. It is unexported, so this needs a narrow exported entry point
rather than reaching for the sequence because the name matches.

## The surface

`/list`, and only `/list`. It is where the Auth0 callback lands, so it is the
first screen an affected person sees, and it is the only screen they are
guaranteed to reach.

`/recipes` is deliberately left alone. Its empty state is arguably where the
question *"where are my recipes?"* forms most sharply, but one surface is one
thing to get right, and a message that can appear twice in a session reads as a
bug.

**Onboarding was rejected as the home for it, on the merits rather than to avoid
a collision.** A "not what you're expecting?" line is a note of doubt on a
welcome screen — and board item **#42** argues at length that the empty account
is already where people are lost. There is also no onboarding screen today: the
callback bypasses `pages/index.tsx`, which records `onboarded` and "no longer
routes anybody". #42 has been annotated with the interaction, so whoever
sequences that flow can decide how lightly to acknowledge this group.

### The condition, and the flash

The condition is "this account has no recipes", **not** "this shopping list is
empty" — a returning user with a full library and nothing picked must never see
it.

`/list` already loads the account's recipes: the sidebar renders
`components/shopping-list/Recipes`, which renders `components/recipe-list`, which
calls `useRecipes()`. TanStack dedupes on `queryKeys.recipes`, so the condition
costs no new request.

But `useRecipes` returns `[data ?? []]` and **swallows the loading state**, so
`recipes.length === 0` is true while the fetch is in flight. Rendered on that,
the panel flashes on every load for every user, including someone with two
hundred recipes.

This codebase has been here before and left the lesson in `pages/account.tsx`:
the invite message is "gated on the invites query having resolved, not just on
the router", and `otherMembers` is "deliberately not defaulted" because a default
reads as a real answer while the request is still in flight. Same trap, same fix.
`useRecipes` gains a resolved flag — `return [data ?? [], isSuccess] as const` —
which every existing `const [recipes] = useRecipes()` call site ignores
harmlessly.

## The notification email

Everything above makes the grant hard to obtain. None of it lets the account
owner **find out**. A successful trick, or an honest mistake, adds a permanent
new way into an account and says nothing to anybody outside that browser session.

So linking sends a transactional email to the original account's address: a new
sign-in method was added, which one, when, and the support address if it was not
them. It is the one place SendGrid belongs in this design, because it **carries
no grant** — no link, no token, nothing to act on — so phishing it achieves
nothing.

The transactional family already exists (`service/email/transactional.go`,
`KindInvite` and friends), so this is a new `Kind` and a template, not new
machinery. Best-effort and asynchronous like the rest: a send failure must never
fail the link, which has already happened by then.

## Rejected: unlinking

`/account` gains a recovery entry point and nothing else — no list of sign-in
methods, no way to remove one.

Removal is a real feature, and it wants its own thinking rather than a checkbox
on this one. The reason is that **it would not durably work**: remove Microsoft
from your account, sign in with Microsoft again, and `LinkOrCreateIdentity` case
2 finds your verified address and links it straight back. The unlink silently
undoes itself. It *is* durable for Apple relay and for a genuinely different
address, because nothing matches — so one button would behave differently
depending on the provider, for reasons no user could possibly infer. Making it
durable means a "do not re-link this" marker: new state, new failure modes, and a
new way to lock yourself out of your own account.

## Implementation sequence

### Phase 0 — the resolved flag

Widen `useRecipes` to report whether its query has resolved. Purely additive; no
call site changes. Done when a test proves an unresolved query is
distinguishable from an empty one.

### Phase 1 — the server, with no UI

`POST /link/start` and `POST /link/complete`, plus the exported cascade entry
point. Whether the pending-link token needs a table or can be a signed stateless
value is an implementation call — single-use argues for a row, and
`purgeExpiredInvites` is the established pattern for cleaning one up lazily.

Done when tests cover: a token bound to a different subject is refused; an
expired token is refused; a missing or wrong nonce is refused; a source account
holding recipes is refused; and a successful link leaves no orphaned `account`
row.

### Phase 2 — the flow

`/link/confirm`, the redirect with `prompt=login`, the nonce, and the confirmation
copy. **`/link/confirm` needs an entry in `lib/analytics/page-titles.ts` or the
route test fails** — see CLAUDE.md's note on why the title never comes from
`document.title`.

Done when the whole path works end to end against a real tenant with two
providers.

### Phase 3 — the surface

The `/list` panel behind the resolved-and-empty condition, and the `/account`
entry point.

### Phase 4 — the notification

A new `email.Kind` and template.

## Accepted weaknesses

Stated so they are not rediscovered as bugs:

- **They must reach `/list` and read it.** Someone who concludes Big Shop lost
  their data may simply leave. Prevention is the real answer and is out of scope.
- **They must remember which provider they used originally**, and we cannot tell
  them. Answering "that address signed up with Google" turns the endpoint into an
  account-enumeration oracle, which is the same reason the collision screen in
  the closed PR #138 could not name a provider either. They can guess by trying;
  a repeat of the provider they are already using is detected and explained.
- **Relay users still get a blank account first.** This is recovery, not
  prevention.
- **Nothing helps someone with two genuinely populated accounts.** They are
  refused and pointed at support, deliberately.

## Questions closed on review, 2026-09-02

Recorded rather than deleted, because each of them is a thing somebody will
later wonder was overlooked.

- **Rate limiting: not now.** `POST /link/start` is authenticated and cheap, and
  the worst an authenticated caller achieves by hammering it is issuing tokens
  bound to their own subject, which do nothing without also passing the nonce and
  a successful re-authentication. There is no per-user cap anywhere in this API
  today, so adding the first one here would mean building the mechanism as well
  as the policy. If a cap is ever wanted, this is still a reasonable first place
  to put one — it is just not a reason to hold this up.
- **Consent: settled, no special handling.** The abandoned user consented moments
  earlier as that identity; the cascade deletes the record with the rest of their
  rows, and the surviving account carries its own. `ConsentSync` re-records
  against the surviving user on the next load, so the outcome is a consent record
  attached to the person who actually continues to exist — which is what
  `migrations/034` wants of it.
- **`/recipes` does not get the entry point.** Considered and dropped. `/list` is
  where the callback lands and is the only screen an affected person is
  guaranteed to reach; a second surface is a second thing to keep right, and a
  message that can appear twice in one session reads as a bug. See "The surface".
