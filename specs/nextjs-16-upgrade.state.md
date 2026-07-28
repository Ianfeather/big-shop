---
spec: specs/nextjs-16-upgrade.md
status: in-progress
branch: implement/nextjs-16-upgrade
pr:
---

Scope note: this run covers the spec's Phases 1-3 only, in a single PR, per the
user's instruction at kickoff. Phase 4 (React 19 + @auth0/auth0-react v2) is
deliberately deferred to a separate run - the spec already fences it that way,
and it is the one phase no automated test in this repo can cover
(DISABLE_AUTH=true means every test path uses useMockAuth0).

## Session 1: Toolchain floor - Node 22 and ESLint 9 flat config
Status: done
Scope: Spec Phase 1. .node-version 18.17.0 -> 22; eslint ^8.57.0 -> ^9.39.5,
eslint-config-prettier ^9.1.0 -> ^10.1.8; .eslintrc.json replaced by a native
flat eslint.config.mjs preserving next/core-web-vitals + prettier.
Depends on: none
Commit: (this session)
Notes: Test gate green - eslint clean, tsc --noEmit clean, 118/118 Vitest,
next build succeeds.

Three deviations from the spec's Phase 1 as written, all forced and all
verified by both review sub-agents:

(1) `npm run lint` became `eslint .` and `eslint-config-next` went to ^16.2.12
in THIS session, though the spec assigned both to Phase 2. Phase 1 as written
is self-contradictory: it asks for eslint ^9.39.5 while holding
eslint-config-next ^14.1.0, whose peer range is ^7.23.0 || ^8.0.0 - installable
only via --legacy-peer-deps, which the spec itself forbids. Separately,
`next lint` on Next 14 does not recognise flat config (it drops into its
interactive setup prompt), and eslint-config-next@14 has no working flat-config
path at all: its eslint-plugin-react-hooks is nested under
node_modules/eslint-config-next/node_modules/, which FlatCompat cannot resolve
from the project root. Pulling those two lines forward was the minimal fix, and
it leaves Session 2 as purely the framework bump.

(2) eslint-plugin-react was REMOVED rather than bumped to ^7.37.5 as Phase 1
asks. That spec line assumed the `plugins: ["react"]` declaration survived the
flat-config migration; it did not (core-web-vitals loads the plugin itself, and
re-declaring it is an error in flat config), leaving the direct dependency
referenced by nothing. eslint-config-next still pulls in 7.37.5 transitively.

(3) e2e/** is excluded from linting. `next lint` never covered it, and
Playwright's `async ({ page }, use) => await use(...)` fixture signature reads
to react-hooks as a hook call in a non-component function. Logged as
follow-ups.md #33 rather than left silent.

Review gate: Standards + Spec sub-agents both ran; every CONFIRMED finding
fixed in-session. Standards found two factual errors in my own new comments
(react-hooks resolves to 7.1.1, not the v6 the comment claimed) plus the dead
eslint-plugin-react dependency and stale "Node 14+" in
technical-architecture.md - all corrected. Spec found that the comment's claim
of keeping "lint signal identical to Next 14's" was untrue (react-hooks v7
silently ADOPTS ~12 new rules that happen to pass; only set-state-in-effect had
existing violations) - comment rewritten to say so explicitly. Also removed 3
now-dead eslint-disable-line react-hooks/exhaustive-deps comments; these were
not optional tidying - ESLint 9 flat config defaults
reportUnusedDisableDirectives on, so leaving them would have failed lint.
New follow-ups opened: #32 (set-state-in-effect disabled), #33 (e2e unlinted).

## Session 2: Next.js 14 -> 16
Status: pending
Scope: Spec Phase 2, minus the lint-script and eslint-config-next work already
landed in Session 1. Remaining: next ^14.1.0 -> ^16.2.12; drop swcMinify from
next.config.js; update technical-architecture.md's "Key Dependencies" line
(still reads next@14). No --turbopack (default in 16) and no --webpack (no
custom webpack config exists).
Depends on: Session 1
Commit:
Notes:

## Session 3: Netlify runtime v5
Status: pending
Scope: Spec Phase 3. @netlify/plugin-nextjs ^4.41.3 -> ^5.15.13; re-evaluate the
--ignore-scripts workaround in .github/workflows/ci.yml by running `npm ci`
without it.
Depends on: Session 2
Commit:
Notes:
