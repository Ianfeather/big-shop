---
spec: specs/completed/analytics-and-consent.md
status: complete
branch: implement/analytics-and-consent
pr:
---

Sessions map onto the spec's four Phases, with Phase 1 split across Sessions 1 and 2 — the
privacy policy page is self-contained and user-visible, and lands before the machinery that
links to it.

Decisions taken at planning time that the spec does not contain:

1. **PR #100 (the spec) was merged first** (`e37a91f`), so this branch is cut from `master`
   rather than stacked on the design branch. Ian's call, asked at planning time.
2. **GA4 ships dark.** No GA4 property exists yet, so Session 4 implements the full gated
   path and verifies it locally against a dummy measurement id. It stays inert in production
   until `NEXT_PUBLIC_GA_MEASUREMENT_ID` is set in Netlify — which is the Faro precedent
   (`lib/telemetry/faro.ts`: presence of the endpoint is the switch), not a workaround.
   Session 4's exit criterion "`account.id` appears as a user property" is therefore
   verifiable only in structure locally, not against a real property.
3. **The e2e suite needs the banner pre-dismissed.** `e2e/fixtures.ts` already extends the
   `page` fixture with an `addInitScript` that neutralises Next's dev-mode `nextjs-portal`
   overlay, for exactly the reason a consent banner would also break things — an overlay that
   swallows clicks. Session 2 seeds a consent decision through the same seam, and adds one
   spec that deliberately does not, so the banner itself is still covered.
4. **The privacy policy draft is not sign-off.** Written to be accurate about what this system
   actually does; the wording still wants Ian's read before it is public.

## Session 1: Privacy policy page
Status: done
Scope: Spec Phase 1, first half. `pages/privacy.tsx` + styles, the processor list and storage
inventory assembled from the code rather than from a template, Faro described plainly per the
spec's Decided section, footer link from `pages/index.tsx`, and the shared `POLICY_VERSION`
constant that Session 3 records against.
Depends on: none
Commit: 289345e
Notes: Lint/typecheck/244 Vitest tests green. Both review axes ran; every finding was
confirmed against the code and fixed rather than deferred. Three are worth carrying forward:

- **`/privacy` was behind the auth gate.** `_app.tsx`'s `behindAuth` was `route !== '/'`, so a
  logged-out visitor following the footer link was bounced to the homepage. Now a
  `publicRoutes` list. **This is invisible under `npm run dev:full`** - the auth mock reports
  `isAuthenticated: true` unconditionally - so any later session touching a logged-out surface
  must verify with `NEXT_PUBLIC_DISABLE_AUTH=false` against the same containers, and with the
  browser's real Auth0 session cleared. Session 2's banner is exactly such a surface.
- **The page first described the finished feature, not what shipped with it** - it claimed GA
  was in use and pointed at a "Cookie settings" control, neither of which existed. Corrected to
  describe only what is live. **Session 2 must add the cookie-choice storage row and the
  Cookie settings pointer; Session 4 must replace the "no analytics" section.** The page carries
  a comment saying so.
- **A JSX whitespace trap.** Text that spans several lines *and* contains an HTML entity loses
  its leading space after a preceding element, so `<strong>x.</strong> Foo` rendered as `x.Foo`.
  Only the bullets carrying `&mdash;` were hit. Fixed with explicit `{' '}`; the marketing page
  was scanned and is clean.

Also corrected several factual claims the reviews caught: photos are never stored
(`recipe-image.ts` unlinks them), Dave sends whole recipes and list history to OpenAI rather
than just names, and the "four things" list omitted preferences and shopping-list history.

Shared chrome extracted to `pages/public-chrome.module.css`; both public pages compose from it.

Note: `origin/master` moved during this session (#102, request-model-optimisations Phases 4-6).
No overlap with these files; check mergeability before the PR.

## Session 2: Consent store and banner
Status: done
Scope: Spec Phase 1, second half. `hooks/use-consent.ts` (three states — `unset` is what shows
the banner and must not collapse into `denied`), `components/consent-banner/`, mounted in
`_app.tsx` outside `InnerApp` so it never waits on Auth0 (#58). Withdrawal path. e2e fixture
seed plus `e2e/consent.spec.ts`. Vitest tests for the store.
Depends on: Session 1 (banner links to the policy)
Commit: 621c3dc
Notes: 279 unit tests and 31 e2e pass. Both review axes ran; every finding confirmed and fixed.
Carry forward:

- **The banner was undismissable with site data blocked** - `writeConsent` swallows the failure,
  so `readConsent` keeps answering `unset`, which is the state that shows the banner. Fixed by
  also holding the choice in component state (`decidedHere`). The general trap: this store's
  fallback *is* the "keep asking" state, unlike `use-local-storage-flag.ts` whose fallback is a
  usable default. Any later code that treats "no stored consent" as authoritative needs the
  same care.
- **`/account` now carries the in-app Cookie settings control.** `components/layout` has no
  footer and the user menu holds only Account and Logout, so without it consent could be given
  once and never revisited.
- **`/privacy` must not describe analytics as live until Session 4.** This was caught twice now
  (Session 1's review, then Session 2's). The page currently states plainly that nothing is
  collected and explains why the banner asks anyway; **Session 4 replaces that section.**
- Shared with the e2e harness from `lib/consent.ts`: `CONSENT_STORAGE_KEY` and
  `serializeConsent`. Hand-rolling either in the harness fails silently - the seed stops
  counting as a decision and the banner reappears as unrelated click failures across the suite.

**The e2e cold-start race, unresolved and worth watching.** The first full-suite run failed 4
tests with `PageNotFoundError: Cannot find module for page: /recipes/N` - `next dev` failing to
compile the dynamic route while the image built, MySQL migrated and every route compiled at
once. Four subsequent clean runs passed 31/31 with zero occurrences. Not reproduced and not
fixed; CI always starts cold, so **if e2e fails on the PR, check for `PageNotFoundError` before
assuming the change is at fault.** Note also that `npm run test:e2e:stop` must run first - a run
started without it dies on `ECONNREFUSED` against a half-recreated stack, which looks like a
code failure and is not.

**Local verification of any logged-out surface needs `NEXT_PUBLIC_DISABLE_AUTH=false`** against
the same containers, plus clearing the browser's real Auth0 session. Note Next 16 refuses a
second dev server in one directory, so a manually-running `next dev` blocks `npm run test:e2e`
entirely - it fails at webServer startup rather than as a test failure.

## Session 3: Consent record
Status: done
Scope: Spec Phase 2. `migrations/034_consent_event.sql`, append-only, no IP and no user agent.
`service/consent.go`, `app/consent.go` with `POST /consent`. Latest state joins `GET /user` as
a pointer field matching `ShowPantryStaples`, rather than a new read route (#53). Client sync
via `use-synced-flag.ts`'s arrangement. Regenerate `openapi.yaml` and `types/api.d.ts` — CI
gates on drift.
Depends on: Session 2
Commit: f003c03
Notes: 295 unit tests and 33 e2e pass. Append-only verified directly in MySQL after a run:
three rows, `login-sync` (harness baseline), `banner` (accept), `settings` (withdrawal).

**Correction to the spec, applied here rather than by editing it.** Phase 2 asks for both
"the server value wins when it arrives and disagrees" *and* "a decision made before login is
written through on the first authenticated load". Those conflict once both sides hold a
decision, and either rule alone discards a real answer — "server wins" was implemented first
and made a logged-out change on `/privacy` silently revert at the next login. Resolved by
recording `decidedAt` on both sides and taking the newer. A clock-skew tie-break preferring
`denied` was then tried and **removed**: any deliberate change within the window is also two
decisions seconds apart, so it discarded acceptances. Both failures were caught by e2e, not by
review. Residual skew risk is named in `components/consent-sync/index.tsx`.

Carry forward:

- **A server decision against a superseded POLICY_VERSION is not a decision.** Adopting one
  re-stamped it as current and silently dismissed the banner a version bump had just raised.
  Session 4 must not reintroduce this when it reads consent to gate gtag.
- **`ConsentSync` remounts on every crossing between public and authenticated routes**, because
  it lives inside `InnerApp` which `_app.tsx` does not render on `publicRoutes`. Anything added
  there must be idempotent; a "have I run yet" ref does not survive.
- **Under `DISABLE_AUTH` the consent record is one global row for the whole e2e run.**
  `e2e/global-setup.ts` seeds it to match `e2e/fixtures.ts`'s per-test localStorage seed, and
  the fixture stamps `decidedAt` in 2020 deliberately — without both, every spec races to push
  its seeded decision and a single run wrote 27 rows.
- **follow-ups.md #56 was fixed here first, then dropped in a rebase.** This branch carried its
  own 500-to-404 fix because the flake was failing its e2e runs; #56 landed independently on
  master as #99 while Session 3 was in review, and the rebase resolved both conflicts in
  master's favour. Nothing of it remains on this branch, and there is nothing to flag in the PR
  body.

**Rebased onto master after Session 3** (`a7059c6`, `5a9a05c`, `f6926f7`). Two of those matter
to this work:

- **#58 is fixed on master** — `/` no longer redirects, and `pages/_document.tsx` stamps
  `data-auth` before first paint so the homepage decides what it shows without waiting on the
  Auth0 SDK. Comments here that described #58 as a live problem have been corrected, and the
  argument for mounting the banner outside `Auth0Provider` is now *stronger* rather than
  weaker: there is a pre-paint decision to avoid undoing.
- `e2e/consent.spec.ts`'s reason for driving `/privacy` rather than `/` is obsolete (the
  redirect is gone). It stays on `/privacy` on the better grounds that the policy's readability
  before answering is part of what the spec asserts.

## Session 4: GA4 behind the gate
Status: done
Scope: Spec Phase 3. `lib/analytics/ga.ts` shaped like `faro.ts`. No `gtag.js` until granted —
deliberately contrary to Consent Mode v2's intended design, and the reason goes in the code.
Ad signals permanently denied. Withdrawal clears `_ga*`. Manual page views on
`routeChangeComplete`. Static `page_title` lookup with an exhaustiveness test. `account.id` as
a user property, never `user_id`, never the Auth0 subject. Amend ADR-0008 §1.
Depends on: Session 2
Commit: ebf2c5d
Notes: 343 unit tests and 34 e2e pass.

**Verified in a browser with a dummy measurement id**, which the spec requires ("verify in
devtools, not by reading the code"): declining produced zero requests to any Google domain
across a full reload; accepting loaded the tag, queued `consent default` (all four signals
denied) ahead of `config`, and reported a page view carrying the static title "Privacy policy"
while `document.title` read "Privacy — Big Shop"; SPA navigation reported again; withdrawal
stopped further reports, cleared the `_ga*` cookies, and re-granting in the same visit resumed
collection without a second copy of the tag.

**Not verifiable locally: `account_id` as a user property.** It needs a real GA property, and
the local API runs on a non-default port so `GET /user` did not resolve. Structure is
unit-tested; the value is Ian's to confirm once `NEXT_PUBLIC_GA_MEASUREMENT_ID` is set.

Carry forward:

- **Two flags, not one.** `loaded` (the tag is in the page, irreversible) and `collecting` (we
  may send, flips with every decision) are separate because conflating them broke withdrawal in
  both directions - page views kept flowing to a loaded tag after a withdrawal, and re-granting
  in the same visit was a silent no-op. Session 5's events must gate on `collecting`.
- **The router must be read live, not closed over.** `routeChangeComplete` fires from Next, not
  React, so a callback closed over `router.asPath` can report the page being navigated away
  from. `components/analytics` reads through a ref. The unit tests only caught this once the
  router mock used getters instead of a snapshot - a mock that freezes router values tests a
  router nobody has.
- **`/privacy` is now keyed to `enabled()` from `lib/analytics/ga.ts`.** It described a feature
  that was not live three separate times across Sessions 1, 2 and 4, caught in review every
  time and never by reading. It no longer depends on anyone remembering: the wording, the
  processor row and the cookie row all follow the same switch the code uses.
- **`trackEvent` was removed from `ga.ts`** as Session 5's surface. Session 5 adds it back
  along with `lib/analytics/events.ts`, which `ga.ts`'s comment referenced before it existed.
- `NEXT_PUBLIC_GA_MEASUREMENT_ID` is documented in `technical-architecture.md`; Session 5 still
  owns the CLAUDE.md side and `follow-ups.md`.

## Session 5: Events and docs
Status: done
Scope: Spec Phase 4. Four events, no free-text parameters, and the longitudinal-only rule in
the module comment so the Grafana metrics are not duplicated. Move #43 to
`follow-ups-resolved.md`; update CLAUDE.md and `technical-architecture.md` env var tables.
Depends on: Session 4
Commit: c4fcbe2
Notes: 357 unit tests and 34 e2e pass.

**Correction to the spec, applied here rather than by editing it.** Phase 3 says page views
"fire on `routeChangeComplete`". They cannot: with that listener every navigation reported the
*previous* page — saving a Recipe recorded a view for the form it had just left, and the
Recipe's own view appeared one navigation later. Reading the router through a ref did not help.
Reporting now runs from an effect keyed on `router.route`/`router.asPath`, which cannot have the
problem because it runs *because* React re-rendered with those values. Observable behaviour is
what the spec wanted — one view per navigation, none from the tag itself. **The precise cause
inside Next was not pinned down and the code says so**, after an earlier comment asserted a
mechanism that turned out not to describe the code it replaced.

**Verified against the real stack**, per Phase 4's exit criterion, with a dummy measurement id:
`shopping_list_generated` on ticking a Recipe; `recipe_imported` with `source: 'manual'` on a
real save; page views in step across `/recipes → /list → /dave → /recipes` and on to a saved
Recipe, with the shallow `?stored=new` strip producing one view rather than two. `invite_sent`
was exercised and correctly did **not** fire, because `POST /invite` 400s without
`SENDGRID_API_KEY` — which is the meaningful check, since it proves the event is wired to
success rather than to the click.

**`dave_turn` has never been seen to fire.** There is no `OPENAI_API_KEY` locally, so the path
cannot be driven end to end. It is unit-tested and fires on a reply arriving rather than a
question being sent, but it is the one event with no observation behind it.

Carry forward:

- **`lib/analytics/events.ts` is the only permitted caller of `trackEvent`**, and that is now a
  test that greps the tree rather than a comment claiming it. The comment used to assert the
  guarantee while `trackEvent` was a plain export; a fifth event added in a page would have
  passed the four-event and no-free-text assertions, which only read `events.ts`. The guard was
  checked by planting a violation and watching it fail.
- **`RecipeSource` deliberately diverges from `lib/telemetry/metrics.ts`'s `ImportSource`.**
  That type describes extractions, so it has `method-url`/`method-photo` and no `manual` —
  typing a Recipe never runs an extractor. Adding a Source is a two-file edit with no test
  linking them; worth knowing before adding a fifth.
- **The bulk paste box refines `manual` into `text` and nothing else.** The first version
  overrode unconditionally, so a URL import topped up with one pasted ingredient reported
  `text` and lost the `url` attribution.
