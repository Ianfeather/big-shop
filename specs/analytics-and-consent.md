# Google Analytics, and the consent foundation it requires

Implements [`follow-ups.md`](../follow-ups.md) #43. Extends
[ADR-0008](../docs/adr/0008-what-telemetry-does-not-carry.md) to a second recipient — see
Phase 3, which amends it.

The framing #43 sets and this spec keeps: **shipping the tag without the other two parts is
the non-compliant version.** A privacy policy, a consent banner and GA4 are one item because
GA4 sets first-party cookies, which under UK PECR is non-essential storage requiring opt-in.
That is a dependency, not a footnote.

Scope is one GA4 property covering **both** surfaces — the public marketing homepage (`/`) and
the authenticated app. A homepage-only install would not have needed any of the compliance
work; covering the app is what drags it in, and is also what makes this the measurement half
of #42. The funnel that item describes (read the page → sign up → land in an empty account) is
not observable at any step today, so there is currently no way to tell whether the onboarding
work moves anything.

## Current state (why this isn't greenfield, and where it is)

Genuinely greenfield:

- **No analytics of any kind.** No `gtag`, no GTM, no `_document.tsx`, no CSP headers to work
  around. Nothing to migrate off.
- **No privacy policy page, and no consent UI.** Neither exists in any form.

Not greenfield, and load-bearing for the design below:

- **The Go API has no unauthenticated write path, and only one unauthenticated path at all.**
  Every operation registered in `GetRouter` sits behind `jwtHandler()` + `userMiddleware`
  (or `devUserMiddleware` under `DISABLE_AUTH`). `/health` is the sole carve-out, and it is
  deliberately handled *in the negroni stack before the mux* rather than registered as a
  route. `/tags`, `/units` and `/ingredients` are "public" only in the `Cache-Control` sense
  — they still require a token. This is a fail-closed design stated as such in `app.go`, and
  it is why the anonymous-consent question below is a real decision rather than a detail.
- **The two-layer preference pattern already exists and is the right shape for consent.**
  `hooks/use-local-storage-flag.ts` (a `useSyncExternalStore` flag with an explicit server
  snapshot, cross-tab `storage` listener and a try/catch for browsers with site data blocked)
  and `hooks/use-synced-flag.ts` (localStorage as a *cache*, server as source of truth,
  adopting only on remote *change* so a click isn't reverted mid-flight). Migration 033 and
  `show_pantry_staples` are the worked example. Consent is a third instance of the same
  problem and should not invent a fourth mechanism.
- **Faro starts at module-evaluation time in `_app.tsx`**, before first paint, deliberately —
  so that errors thrown during initial render are caught. It stays ungated; see Decided.
- **`pages/index.tsx:417` has a footer.** That is where the privacy policy link lives on the
  marketing page.
- **`hooks/use-user.ts` fetches `GET /user`** for view preferences and treats a 404 as "nothing
  recorded yet". Consent state joins that payload rather than adding a round trip — #53 is
  live work about cutting round trips, and a new `GET /consent` would push in the other
  direction.

## The one decision this spec asks for before Phase 2

Consent is given on `/`, the marketing page, where the visitor is **anonymous**. The API has
nowhere to put that. Two answers, and they are not close:

- **Recommended: the server record covers authenticated users only.** localStorage is the live
  decision for everyone from the first click. When a user authenticates, the current state is
  synced to `POST /consent` and thereafter follows them across devices — exactly
  `use-synced-flag.ts`'s arrangement. An anonymous visitor's decision is honoured completely
  and recorded only in their own browser.

  The argument is not convenience. To give an anonymous visitor a server-side consent record
  you must first mint and store an identifier for them — so the mechanism whose purpose is to
  document lawful processing would begin by creating a tracking identity for someone who may
  have just declined. Everyone whose data Big Shop actually holds ends up with a record; the
  people without one are the people there is nothing to demonstrate against.

  **The accepted gap, stated plainly:** an anonymous visitor who accepts, generates GA4
  pageviews, and never signs up has no record in Big Shop's database. Their consent state does
  travel with the GA hits themselves, which is a weaker but non-zero record.

- **Alternative: a public `POST /consent`.** Records every decision, anonymous ones keyed by a
  random client-minted id in localStorage. Costs the API's first unauthenticated write
  endpoint, which needs rate limiting that does not exist today (`internal/pkg/purge`'s
  throttle is outbound and not reusable), and creates an unauthenticated append-to-a-table
  primitive — the same shape #54 objects to on the JWKS path.

Phase 2 is written for the recommended option. Choosing the alternative changes Phase 2 only.

## Phase 1 — The policy, the store, the banner

No analytics anywhere in this phase. It ships as a complete, useful change on its own: Big
Shop gains a privacy policy it currently lacks regardless of whether GA4 ever lands.

**The privacy policy page** — a real page at `/privacy` in the app's own design language, not
a generated drop-in. The work is the content, and no generator knows it: the processor list has
to be assembled by hand from what this system actually does — Auth0, Netlify, Fly.io, TiDB
Cloud, Grafana Cloud (Faro plus backend telemetry), OpenAI, SendGrid, and Google Analytics once
Phase 3 lands. ADR-0008 is the authority on what is and isn't sent to Grafana and should be
read alongside, not paraphrased from memory.

It also needs a **storage inventory** — the "what we store on your device" table. Enumerate it
by reading the running app rather than by assuming: `_app.tsx` configures Auth0 with
`cacheLocation="localstorage"` and `useRefreshTokens`, so the first-party cookie surface is
smaller than a typical app's and the honest table may be shorter than expected.

**The consent store** — three states, not two: `unset`, `granted`, `denied`. `unset` is what
makes the banner show, and collapsing it into `denied` is the single most likely simplification
a later reader will make; it would mean a visitor who declined is re-asked on every visit,
because "denied" and "never asked" would be indistinguishable. Two categories, essential and
analytics; essential is not a choice and is displayed rather than toggled.

Built on `use-local-storage-flag.ts`'s pattern, generalised from boolean to the three-state
value. `useSyncExternalStore` matters here for the same reason it did there and slightly more:
the banner must not flash on a returning visitor who already decided.

**Mount the banner outside the auth gate.** In `_app.tsx`, alongside `QueryClientProvider` and
outside `InnerApp` — it is not auth-dependent and reads only synchronous localStorage. Doing
this deliberately keeps it clear of #58's problem: the homepage already has a three-state flash
while the Auth0 SDK resolves, and a banner that waited on anything asynchronous would add a
fourth.

**A withdrawal path is part of this phase, not a follow-up.** Consent that cannot be withdrawn
as easily as it was given isn't consent. A "cookie settings" link in the marketing footer and
somewhere reachable from inside the app, re-opening the same UI.

Exit criteria: `/privacy` renders and is linked from the footer; the banner appears once for a
new visitor, never again after a decision, and re-opens on demand; a declined visitor sees no
banner on reload; nothing about the app's behaviour changes for anyone.

## Phase 2 — The consent record

**Append-only, and that is the whole point.** A table where the current state is `UPDATE`d
answers "what do they think now", which localStorage already answers. An audit record has to
answer "what did they consent to, and when" — including consents since withdrawn.

New migration (`034_consent_event.sql`), following the house style of explaining *why* in the
file. Roughly: `user_id` (varchar 255, FK to `user.id`, matching `account_user`), an
`analytics` boolean, a `policy_version` string, a `source` discriminator (`banner` /
`settings` / `login-sync`), and `created_at`. Never updated, never deleted.

`policy_version` earns its place: it is what lets a future material change to the policy
re-prompt only the people whose consent predates it, rather than re-prompting everyone or
nobody.

**No IP address and no user agent.** This is the field a reader will add, reasoning that proof
of consent wants proof of who. It would put fresh personal data into the one table that exists
for privacy compliance, and the ICO's expectation is a record of *how and when* consent was
given, which the columns above already carry.

`POST /consent`, authenticated, registered like every other route. Current state joins the
`GET /user` payload (an extra field on `common.User`, exactly as `ShowPantryStaples` did in
033) rather than becoming a new read route — see the round-trip note above. Note the
`ShowPantryStaples` precedent on pointer-vs-value: `false` is a real answer that has to win
over "absent", so the same treatment applies.

Client side: `use-synced-flag.ts`'s arrangement, one layer up. localStorage stays the paint
source; the server value wins when it arrives and disagrees; a decision made before login is
written through on the first authenticated load.

Exit criteria: a decision made logged-out and then logging in produces a row; changing the
decision produces a second row rather than mutating the first; a decision made on one device
is reflected on another after login; the e2e suite still passes (`DISABLE_AUTH` gives every
request `local-dev-user`, so the sync path is exercisable locally).

## Phase 3 — GA4, behind the gate

**Do not load `gtag.js` until analytics consent is granted.** Consent Mode v2's own design is
to load the tag always and let the consent signal gate storage, sending cookieless pings
meanwhile. That is built for conversion modelling in an ads context, which Big Shop has no use
for, and it still transfers the visitor's IP to Google before they have agreed to anything.
Declining should cost zero bytes and zero requests. Recording this here because "the tag is
supposed to load unconditionally" is a correct reading of Google's docs and a reasonable
person will try to apply it.

Consent Mode is still implemented, because it is what handles the two cases gating alone
cannot:

```js
// Before the tag loads, on grant.
gtag('consent', 'default', {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'denied',
});
gtag('consent', 'update', { analytics_storage: 'granted' });
```

**The three ad signals stay denied permanently.** Big Shop runs no ads and has no ads account.
Granting them "for completeness" when the analytics one flips is the obvious drift; they are
listed explicitly rather than omitted so the intent is visible.

**Withdrawal has to delete the cookies.** Revoking sends
`gtag('consent', 'update', { analytics_storage: 'denied' })` *and* clears the `_ga*` cookies.
Signalling denial while leaving the identifiers on the device is the common half-implementation.

**Page views fire manually on router changes.** Configure with `send_page_view: false` and fire
on `routeChangeComplete`. Every route bar `/` is a client-rendered SPA, so the default single
pageload measures a session as one view.

**`page_title` comes from a static per-route lookup, never from `document.title`.** This is the
enforcement point for #43's warning, and it is worth being concrete about why it is a rule
rather than an observation: nothing leaks *today* only because every `pageTitle` passed to
`components/layout/index.tsx` happens to be static (`"Recipes"`, `"Chat with Dave"`). A future
`{recipe.name} — Big Shop` title — an entirely reasonable change, and a likely one — would ship
Recipe names to Google with no code in this feature being touched.

That is closer than it sounds. `pages/recipes/new.tsx:215` already passes `pageTitle={title}`
from a variable rather than a literal, and the same `title` is reused as the visible `<h1>` on
line 218 — so the day someone wants the heading to read "Editing Ragù" the document title
follows it silently. A lookup keyed by `router.route` cannot do that, and should have a test
asserting it covers every route, in the spirit of `faro.ts` exporting `scrub` for its test.

`page_path` may be the resolved path: Recipe URLs carry numeric ids, which ADR-0008 §1 already
classes as pseudonymous identifiers rather than content.

**Identity: `account.id` as a custom user property, and no `user_id`.** The Account is the unit
the product questions are actually about ("how many Accounts have ever used Dave"), and a user
property answers them without asserting a cross-device person identity. **The Auth0 subject is
never sent to Google** — it goes to Faro and to the API's spans, and that is where it stops.

**Amend ADR-0008 in this phase.** §1's "pseudonymous identifiers, never content" is currently
written as though Grafana is the only recipient. It now governs two, with a tighter rule for
the second: Google receives `account.id` and route templates and nothing else — not the Auth0
subject, not page titles derived from content. The ADR should say so, because the rule is
about to be enforced by a `page_title` lookup that looks arbitrary without it.

Configuration follows the Faro precedent in `lib/telemetry/faro.ts`: the presence of
`NEXT_PUBLIC_GA_MEASUREMENT_ID` is the switch, so a build cannot be "on but misconfigured", and
a deploy preview or a laptop gets no tag at all.

Exit criteria: declining produces no request to any Google domain (verify in devtools, not by
reading the code); accepting loads the tag and registers a pageview; navigating between routes
registers further pageviews; withdrawing stops collection and removes the `_ga*` cookies;
`account.id` appears as a user property and no `user_id` is set anywhere.

## Phase 4 — Events, and the rule that keeps the list short

Four, fixed: **Recipe imported** (parameter: source — url / text / photo / manual), **Shopping
List generated**, **Dave turn**, **Invite sent**.

**GA carries an event only when the question is longitudinal.** Otherwise it stays a Grafana
metric. `observability.md` already specifies an import-outcome counter by source and result and
a duration histogram by route; duplicating those in GA is the obvious drift, and this rule is
what prevents it. The test is whether the question needs more than 14 days of history to
answer — that retention limit is what put GA in scope at all.

No event parameter carries content: no Recipe names, no Dave message text, no email addresses.
Same rule as ADR-0008 §1, now enforced at a second boundary.

Exit criteria: all four fire on the real action against the real stack; no parameter carries
free text; `follow-ups.md` #43 is moved to `follow-ups-resolved.md` and CLAUDE.md /
`technical-architecture.md` updated where they describe the frontend's environment variables.

## Decided — do not re-litigate without a load-bearing reason

- **Faro is not gated by the banner.** Frontend error reporting stays always on, treated as
  necessary for service integrity. #43 records this as a knowing risk rather than an oversight:
  the "strictly necessary" exemption is narrow and error monitoring is a contested fit under
  it. The alternative — putting Faro under the analytics category — blinds error reporting for
  everyone who declines, which is the thing `observability.md` exists to provide. The privacy
  policy must describe Faro plainly rather than quietly.
- **Own implementation rather than a CMP.** Decided 2026-08-16 against Cookiebot/CookieYes free
  tiers and against Klaro/orestbida. Two categories with no IAB TCF is a few hundred lines; a
  hosted CMP would put a render-blocking third-party script on the marketing page — the screen
  #42 and #58 both identify as the fragile one — and would add a data processor to the very
  policy this work exists to write.
- **The consent record is server-side.** Decided 2026-08-16 over client-only. Phase 2 exists
  because of that choice; the anonymous-visitor gap above is its known edge.

## Out of scope

- **Anything to do with email.** #50 notes that marketing email drags in the same compliance
  surface, and it is right, but the lawful basis for a lifecycle send and a working unsubscribe
  are that spec's problem. This one stops at analytics storage.
- **A cookie *scanner*.** The inventory is written by hand because it is knowable by hand.
- **Making `/` decide auth server-side.** #58's second direction would interact with the banner
  and is worth doing, separately, on its own merits.
