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
Commit: f0cb1dc
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
Status: done
Scope: Spec Phase 2, minus the lint-script and eslint-config-next work already
landed in Session 1. next ^14.1.0 -> ^16.2.12; swcMinify dropped from
next.config.js; no --turbopack (default in 16) and no --webpack (no custom
webpack config exists); doc version references updated.
Depends on: Session 1
Commit: 57e7829
Notes: Test gate green - eslint clean, tsc --noEmit clean, 118/118 Vitest
across 28 files (unchanged by the renames below), next build succeeds on
Turbopack, and the full Playwright suite passes 21/21 against the real Go API
and MySQL.

THE SPEC'S CENTRAL CLAIM WAS WRONG. It said the application code "needs
essentially nothing" on the basis that a sweep found zero call sites for any
API removed or made async in 15/16. That sweep was accurate but looked only for
call sites; it missed a new *build-time* validator. Next 16 generates
.next/types/validator.ts asserting `handler satisfies ApiRouteConfig` for every
route, and ApiRouteConfig requires a default export. Two pre-existing defects
that Next 14 swallowed silently became hard build failures:

(1) The four pages/api/**/*.test.ts files were being compiled and deployed as
serverless functions, because Next treats every file under pages/ whose
extension is in pageExtensions as a route. Renamed to *.test.mts, which is
outside pageExtensions so Next ignores them, while Vitest still matches them
via its default **/*.{test,spec}.?(c|m)[jt]s?(x) pattern. tsconfig.json gained
a pages/**/*.mts include entry to keep them type-checked. vitest.config.js had
a long comment documenting this as a harmless "pre-existing quirk" - it was a
latent bug, and that comment is now rewritten.

(2) pages/api/dave/tools.ts is a helper module with only named exports,
imported by chat.ts, and was shipping as a broken lambda at /api/dave/tools.
Moved to lib/dave/tools.ts, matching the existing lib/recipe-import/ pattern.
tsconfig gained lib/**/*.ts - note this newly covers only two files
(lib/dave/tools.test.ts, lib/recipe-import/known-names.test.ts); the rest of
lib/ was already pulled in transitively via imports, so this is a smaller
change than it looks. The build's route list is now correct for the first
time: 5 real API routes, where it previously also shipped 5 dead ones.

(3) tsconfig.json "jsx": "preserve" -> "react-jsx". Not a choice - Next 16
rewrites it on every build ("mandatory changes were made to your
tsconfig.json"), verified against a clean .next. Next did NOT reformat the rest
of the file, so the diff stays minimal.

Manual verification beyond the automated gates, since the e2e suite intercepts
the import API routes and does not cover Dave at all: /api/dev/openapi-spec
returns 200 (a real pages/api handler executing under Next 16);
POST /api/dave/chat returns a clean 400 validation error rather than a
module-resolution 500, which is what proves the rewritten lib/dave/tools
import resolves at runtime; /dev/api-docs, /dave and /recipes all render in a
real browser with full content.

Review gate: Standards + Spec sub-agents both ran; every CONFIRMED finding
fixed. Between them they caught a stale duplicate of the now-false .next/
rationale left in eslint.config.mjs, an over-claiming tail on the rewritten
vitest.config.js comment, two prose "Next.js 14" references
(technical-architecture.md:9, CLAUDE.md:5), a self-contradiction where
technical-architecture.md still described JWTs being attached by use-http
interceptors, and a ~30-line CLAUDE.md "Known rough edge" section built
entirely on use-http, a dependency removed some time ago - all fixed. One
Standards finding was itself wrong: it reported that reverting the jsx change
sticks, having tested with a warm .next; on a clean build Next rewrites it
every time. New follow-up opened: #34 (swagger-ui-react logs a non-fatal
TypeError under Turbopack on the dev-only /dev/api-docs page - confirmed
bundler-specific by running the same commit under next dev --webpack, which is
clean, vs Turbopack, which is not; both render all 23 operations).

## Session 3: Netlify runtime v5
Status: pending
Scope: Spec Phase 3. @netlify/plugin-nextjs ^4.41.3 -> ^5.15.13; re-evaluate the
--ignore-scripts workaround in .github/workflows/ci.yml by running `npm ci`
without it.
Depends on: Session 2
Commit:
Notes:
