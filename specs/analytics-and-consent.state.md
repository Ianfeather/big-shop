---
spec: specs/analytics-and-consent.md
status: in-progress
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
Status: pending
Scope: Spec Phase 2. `migrations/034_consent_event.sql`, append-only, no IP and no user agent.
`service/consent.go`, `app/consent.go` with `POST /consent`. Latest state joins `GET /user` as
a pointer field matching `ShowPantryStaples`, rather than a new read route (#53). Client sync
via `use-synced-flag.ts`'s arrangement. Regenerate `openapi.yaml` and `types/api.d.ts` — CI
gates on drift.
Depends on: Session 2
Commit:
Notes:

## Session 4: GA4 behind the gate
Status: pending
Scope: Spec Phase 3. `lib/analytics/ga.ts` shaped like `faro.ts`. No `gtag.js` until granted —
deliberately contrary to Consent Mode v2's intended design, and the reason goes in the code.
Ad signals permanently denied. Withdrawal clears `_ga*`. Manual page views on
`routeChangeComplete`. Static `page_title` lookup with an exhaustiveness test. `account.id` as
a user property, never `user_id`, never the Auth0 subject. Amend ADR-0008 §1.
Depends on: Session 2
Commit:
Notes:

## Session 5: Events and docs
Status: pending
Scope: Spec Phase 4. Four events, no free-text parameters, and the longitudinal-only rule in
the module comment so the Grafana metrics are not duplicated. Move #43 to
`follow-ups-resolved.md`; update CLAUDE.md and `technical-architecture.md` env var tables.
Depends on: Session 4
Commit:
Notes:
