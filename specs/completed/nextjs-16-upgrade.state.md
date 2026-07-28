---
spec: specs/completed/nextjs-16-upgrade.md
status: complete
branch: implement/nextjs-16-upgrade
pr: https://github.com/Ianfeather/big-shop/pull/68 (Phases 1-3), https://github.com/Ianfeather/big-shop/pull/69 (Phase 4)
---

Scope note: Phases 1-3 shipped together in PR #68 (merged as 4a01c7e), per the
user's instruction at kickoff. Phase 4 (React 19 + @auth0/auth0-react v2) was
deferred to its own run and is recorded as Session 4 below - the spec fences it
that way because it is the one phase no automated test in this repo can cover
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
applies it as a "mandatory change", verified against a clean .next.

Precisely: Next rewrites the WHOLE file, reformatting every array onto multiple
lines, but only on a build where it actually has a mandatory change to apply.
Once "jsx" is already "react-jsx" it leaves the file untouched. An earlier
version of this note claimed Next never reformats, which was wrong - it was
written after checking only the "jsx" line rather than the whole file, and the
committed tsconfig.json did carry ~20 lines of pure reformatting churn until
Session 3's review caught it. The file is now stored compact, which survives
repeated clean builds, so the real diff is 3 lines: "jsx" plus the two include
entries.

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
Status: done
Scope: Spec Phase 3. @netlify/plugin-nextjs ^4.41.3 -> ^5.15.13; the
--ignore-scripts workaround removed from BOTH GitHub workflows after verifying
`npm ci` without it; netlify.toml unchanged, as the spec predicted.
Depends on: Session 2
Commit: 1da8364
Notes: Static gate green - eslint clean, tsc clean, 118/118 Vitest, Turbopack
build green, and 21/21 Playwright re-run after a from-scratch `npm ci`.

THE DEPLOY GATE IS NOT MET AND CANNOT BE MET LOCALLY. The spec is explicit that
this phase's "failure mode is invisible locally" and that its gate is "a Netlify
deploy preview that builds and serves the app correctly. Confirm the build log
shows the v5 runtime and a Turbopack build." Nothing in the local suite touches
the runtime - @netlify/plugin-nextjs is a devDependency that no lint, type,
test or build step loads. Every green check on this branch says nothing about
whether the deploy works. This must be checked on the PR's preview before merge.

--ignore-scripts: removed, and verified rather than assumed, as the spec
demanded. `npm ls @netlify/esbuild` is empty (v5 has no dependencies block at
all - v4's tree was bundled), and `npm ci` without the flag exits 0 both on
macOS and in a node:22-bookworm container, which is the same environment the
original comment cited as proof of failure. Note this newly runs install
scripts in CI (esbuild, sharp, core-js, tree-sitter) - a new install surface
that passed in the container run but had not executed in CI before.

Also changed .github/workflows/e2e.yml, which the spec never mentions. It
carried a byte-identical copy of the same flag and the same now-false comment;
leaving it would have left exactly the "stale explanation" the spec forbids.

Review gate: Standards + Spec sub-agents both ran; every CONFIRMED finding
fixed. Standards caught that my first rewrite of the workflow comments made
things worse - six identical lines in two files documenting a flag that is no
longer there, while dropping the one durable fact worth keeping (why
@netlify/plugin-nextjs is a devDependency at all). Both are now four lines
carrying that fact. It also noted the Deployment section of
technical-architecture.md never mentioned the runtime, now added. Spec caught
the inaccurate tsconfig reformatting claim in Session 2's notes above, now
corrected along with the file itself. Both independently confirmed the lockfile
shrinking by ~2000 lines is fully explained by v4's bundled tree going away,
with nothing needed lost.

## Session 4: React 18 -> 19 and Auth0 SDK v1 -> v2
Status: done
Scope: Spec Phase 4, run separately from Phases 1-3 and on its own branch
(implement/react-19-upgrade). react/react-dom ^18.2.0 -> ^19.2.8, @types/react
-> ^19.2.17, @types/react-dom -> ^19.2.3, @auth0/auth0-react ^1.2.0 -> ^2.22.0.
Depends on: Session 3
Commit: ffe95f9
Notes: Static gate green - eslint clean, tsc clean, 118/118 Vitest, Turbopack
build green, 21/21 Playwright.

THE SPEC'S PHASE 4 CALL-SITE COUNT WAS WRONG, in both directions. It said "the
SDK surface is touched in exactly two files: pages/_app.tsx and
hooks/use-auth.ts".

- It MISSED three files: components/identity/{login,create,logout}/index.tsx.
  These are the actual Log In / Sign Up / Sign out buttons, and they reach the
  SDK through @hooks/use-auth rather than importing @auth0/auth0-react, so the
  import-grep that produced the spec could not see them. All three carried v1
  shapes (redirectUri, screen_hint at the top level, returnTo) and all three
  needed the v2 nesting. typecheck caught every one.
- hooks/use-auth.ts needed NO change for the migration itself:
  RedirectLoginOptions and LogoutOptions are still exported from v2 and the
  overloaded getAccessTokenSilently stays assignable.

The spec's "No React 19 codemods are expected to be needed" was narrowly true
(no defaultProps, propTypes, string refs or ReactDOM.render anywhere) but
missed a typing change: @types/react 19 types useRef<T>(null) as
RefObject<T | null>, so hooks/use-overflow.ts's declared return type no longer
matched and was widened.

THE SPEC'S GATE IS NOW MET. It required "an authenticated manual pass - login,
token refresh after a page reload, and logout, against the real Auth0 tenant"
and said "Phase 4 is not done until someone has logged in against the real
tenant." The repo owner confirmed auth works against the real tenant on
2026-07-28, which is the only way this could ever have been closed - no
automated test in this repo can reach it.

Recorded below is what the branch itself was able to verify before that, kept
because it says exactly which parts had machine-checkable evidence and which
rested on the manual pass. A dev server was run with
NEXT_PUBLIC_DISABLE_AUTH=false, Log In and Sign
Up were clicked, and the outgoing /authorize request was intercepted and
ABORTED to read its query string. Both produced redirect_uri, audience,
response_type=code and scope including offline_access; Sign Up additionally
carried screen_hint=signup. No page errors, so Auth0Provider mounts under
React 19.

That proves the authorizationParams restructure serialises correctly. It proves
nothing past the redirect: no token exchange, no handleRedirectCallback, no
getAccessTokenSilently (so no bearer token was ever produced or accepted by the
Go API), no refresh-after-reload, and no logout at all - the Sign out button
only renders once authenticated, so logoutParams is verified by tsc alone.

One related question was settled rather than assumed, because it decides
whether already-logged-in users get silently signed out on deploy: the
localStorage cache key format is UNCHANGED between the auth0-spa-js the app had
(1.22.6, via auth0-react v1.12.1) and the one it has now (2.24.0). v1 serialises
`${prefix}::${client_id}::${audience}::${scope}`; v2 serialises
[prefix, clientId, audience, scope, suffix].filter(Boolean).join("::"), which is
byte-identical when suffix is undefined, as it is in this configuration. So
existing sessions are expected to rehydrate. Still worth confirming during the
real login pass, since matching keys do not guarantee a matching entry body.

Review gate: Standards + Spec sub-agents both ran. Standards confirmed the
migration is complete (repo-wide grep across all file types, not just SDK
importers, finds only correctly-nested v2 forms) and found two things to fix:
a comment in use-overflow.ts claiming callers pass the ref straight through
when the hook has no callers but its own test, and UseAuthResult declaring
loginWithRedirect/logout as `=> void` when the SDK returns Promise<void> -
shaped to the mock rather than the SDK, and type-checking only because `void`
swallows a promise. Both fixed; the interface and the mock now both return
promises. Spec review's central finding was the gate shortfall recorded above.
One Spec claim was itself wrong - that the v1->v2 localStorage key format
changed and would drop sessions - disproved by the cache-key comparison above.
New follow-up opened: #35 (swagger-ui-react's nested deps declare peers that
exclude React 19; no actual breakage - /dev/api-docs renders identically before
and after, with only the pre-existing #34 Turbopack errors).
