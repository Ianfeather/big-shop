# Upgrade Next.js 14 → 16 (and React 18 → 19)

## Current state (why this isn't just `npm install next@latest`)

Big Shop is on `next@14.2.26` / `react@18.3.1`, two majors behind `next@16.2.12`. The
application code itself is in unusually good shape for this jump — a sweep of every
API removed or made async across 15 and 16 found **zero call sites**:

- **No App Router.** `pages/` only; there is no `app/` directory. The entire Next 15
  "Async Request APIs" breaking change (`cookies`/`headers`/`draftMode`/`params`/
  `searchParams` becoming Promises) and its Next 16 follow-up (synchronous access
  fully removed) are App Router concerns and do not apply here. The only two
  `getServerSideProps` in the repo (`pages/dev/design-system.tsx`,
  `pages/dev/api-docs.tsx`) keep their existing synchronous Pages Router contract.
- **No `next/image`, no `next/font`, no `middleware.ts`, no `_document.tsx`.** So none
  of Next 16's image-config breaking changes (`minimumCacheTTL` 60s→4h, `qualities`
  default `[75]`, `imageSizes` losing `16`, local-IP restriction, `maximumRedirects`),
  the `middleware`→`proxy` rename, or the `scroll-behavior` override change land on us.
  Fonts are already self-hosted in `pages/styles.css` for unrelated reasons.
- **No `publicRuntimeConfig`/`serverRuntimeConfig`, no `next/config`, no AMP, no
  `next/legacy/image`, no `next/server`/`NextRequest`, no `experimental-edge`, no
  `useFormState`.** All removed in 15 or 16; none used.
- **No custom `webpack` config**, in `next.config.js` or anywhere else. This matters a
  lot: Next 16 makes Turbopack the default for `next build`, and a build **fails hard**
  if it finds a webpack config. We have none, so Turbopack is a straight adoption.

What actually needs work is the **toolchain and deployment surface around** the app:

- **`.node-version` pins `18.17.0`.** Next 16 requires Node `>=20.9.0`. This is the
  single most likely thing to break the Netlify deploy while every local check passes,
  because CI (`.github/workflows/ci.yml`, `e2e.yml`) already runs Node 22 and local dev
  is on Node 22 — only Netlify reads `.node-version`.
- **`next lint` is removed in Next 16.** `npm run lint` is `next lint`, and it's wired
  into `npm run package`, which `build.sh` (Netlify's actual build command) runs first.
  So the deploy build breaks on the lint step, not the build step.
- **`.eslintrc.json` is legacy eslintrc format on ESLint 8.** `eslint-config-next@16`
  requires `eslint >= 9` and `@next/eslint-plugin-next` now defaults to flat config.
- **`@netlify/plugin-nextjs` is pinned to `4.41.3`** in `package.json` and referenced by
  `netlify.toml`. The v4 runtime supports Next 10–13.4 only. The v5 runtime
  (`5.15.13`) covers Next 13.5+ including 16, with Turbopack builds and no config
  changes needed beyond `publish = ".next"`, which we already have.
- **`next.config.js` sets `swcMinify: true`**, removed as a config option in Next 15
  (the behavior is now unconditional).
- **`@auth0/auth0-react` is on `1.12.1`.** Its peer range stops at React 18, so it is
  the one hard blocker on React 19. v2 is a breaking config change, but the SDK
  surface is touched in exactly two files: `pages/_app.tsx` and `hooks/use-auth.ts`.

Everything else in `package.json` is already React-19-ready: `@tanstack/react-query`
peers `^18 || ^19`, `swagger-ui-react` peers `>=16.8.0 <20`, `@testing-library/react@16`
peers `^18 || ^19`.

## Proposed approach

Four phases. **Phases 1–3 land Next 16 on React 18 and are independently deployable** —
after Phase 3 the app is fully upgraded, green, and shipped. Phase 4 is the React 19 +
Auth0 v2 step, fenced off so that if the deploy misbehaves it's obvious which change
did it.

### Phase 1 — Toolchain floor: Node and ESLint

Nothing Next-version-specific here. Done first so Phase 2's failures are unambiguously
Next 16 failures.

- `.node-version`: `18.17.0` → `22`. Brings Netlify in line with CI and local dev, and
  clears Next 16's `>=20.9.0` engine requirement ahead of the version bump.
- `eslint` `^8.57.0` → `^9.39.5`; `eslint-config-prettier` `^9.1.0` → `^10.1.8`
  (v10 is the flat-config-native line); `eslint-plugin-react` `^7.33.2` → `^7.37.5`.
- Replace `.eslintrc.json` with `eslint.config.mjs` in flat config format, preserving
  today's effective ruleset: `next/core-web-vitals` + `eslint-config-prettier`.
  Drop the explicit `plugins: ["react"]` entry and the
  `"react/react-in-jsx-scope": "off"` rule — `next/core-web-vitals` already pulls in
  the React plugin and already disables that rule, so both lines are redundant and
  re-declaring the plugin in flat config is an error, not a no-op.
- Leave `npm run lint` as `next lint` for this phase. On Next 14 with ESLint 9 and a
  flat config, `next lint` still works; converting the script is Phase 2's job, so
  that a lint failure here is a *rules* problem and not a *runner* problem.

Gate: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` all green.

### Phase 2 — Next.js 14 → 16

Skip 15 as a landing point. There is no 14→15-only breaking change that affects this
codebase (verified above), so stopping at 15 would mean a second full round of
regression testing to buy nothing. Go straight to `16.2.12`.

- `next` `^14.1.0` → `^16.2.12`; `eslint-config-next` `^14.1.0` → `^16.2.12`.
- `next.config.js`: delete `swcMinify: true`. Keep `productionBrowserSourceMaps` and
  `reactStrictMode` (both still supported, and Strict Mode is load-bearing for the
  dev-only abort behavior CLAUDE.md documents — do not quietly drop it to make a
  double-render warning go away).
- `package.json` `"lint"`: `next lint` → `eslint .`. Add an `eslintIgnore`-equivalent
  `ignores` block to `eslint.config.mjs` covering `.next/`, `node_modules/`,
  `playwright-report/`, `test-results/` — `next lint` scoped itself to source
  directories implicitly; bare `eslint .` does not, and `.next/` contains a compiled
  copy of every `pages/api/**/*.test.js` (the same quirk `vitest.config.js` already
  works around).
- Do **not** add `--turbopack` flags. Turbopack is the default for both `next dev` and
  `next build` in 16; the flags are now no-ops. Equally, do **not** add `--webpack` —
  with no custom webpack config there is nothing to opt out for.

Gate: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`,
`npm run test:e2e` (the full Playwright suite — this is the one that exercises the real
API through a real browser, and per CLAUDE.md it's the only thing that catches
API-boundary regressions Vitest can't see), plus a manual pass over
`npm run dev:full` covering Recipe CRUD, the Shopping List, and at least one Recipe
Import Source.

### Phase 3 — Netlify runtime v5

Kept separate from Phase 2 because it is the only change whose failure mode is
invisible locally: it can only be validated on a Netlify deploy preview.

- `@netlify/plugin-nextjs` `^4.41.3` → `^5.15.13`.
- `netlify.toml` needs no change — the `[[plugins]] package = "@netlify/plugin-nextjs"`
  entry and `publish = ".next"` are both still correct for the v5 runtime.
- Re-evaluate `--ignore-scripts` in `.github/workflows/ci.yml`. The long comment there
  explains it exists solely because plugin v4 drags in `@netlify/esbuild@0.14.39`,
  whose postinstall fails on Linux. If v5 no longer pulls that in, the flag and its
  comment should go. **Verify by actually running `npm ci` without the flag** — do not
  remove it on the assumption that v5 fixed it, and if it turns out still to be needed,
  update the comment to say why rather than leaving a stale explanation.

Gate: a Netlify deploy preview that builds and serves the app correctly. Confirm the
build log shows the v5 runtime and a Turbopack build.

### Phase 4 — React 18 → 19 and Auth0 SDK v1 → v2

Only start once Phases 1–3 are merged and deployed.

- `react`/`react-dom` `^18.2.0` → `^19.2.8`; `@types/react` `^18.3.31` → `^19.2.17`;
  `@types/react-dom` `^18.3.7` → `^19.2.3`.
- `@auth0/auth0-react` `^1.2.0` → `^2.22.0`. Two call sites:
  - `pages/_app.tsx` — v2 moves `redirectUri` and `audience` off the `Auth0Provider`
    props and into a nested `authorizationParams` object, with `redirectUri` renamed to
    `redirect_uri`. `domain`, `clientId`, `useRefreshTokens` and `cacheLocation` stay
    top-level. The `requireEnv` fail-fast wiring around `NEXT_PUBLIC_AUTH0_DOMAIN` /
    `NEXT_PUBLIC_AUTH0_CLIENT_ID` is unaffected and should be preserved as-is.
  - `hooks/use-auth.ts` — `RedirectLoginOptions` and `LogoutOptions` are still exported
    in v2 but their shapes changed (`logout`'s `returnTo` also moves under
    `logoutParams`). The hand-written `UseAuthResult` interface exists specifically so
    TypeScript checks that both the real `useAuth0` and `useMockAuth0` satisfy it —
    let `npm run typecheck` drive this file rather than adjusting the interface until
    errors disappear.
- No React 19 codemods are expected to be needed: the repo has no `defaultProps` on
  function components, no `propTypes`, no string refs, and no `ReactDOM.render`.

Gate: same as Phase 2, plus an **authenticated** manual pass — login, token refresh
after a page reload, and logout, against the real Auth0 tenant. `DISABLE_AUTH=true`
short-circuits `useAuth0` entirely (`hooks/use-auth.ts` swaps in `useMockAuth0`), so
neither `dev:full` nor the e2e suite exercises a single line of the Auth0 v2
integration. This is the only part of the whole upgrade that automated tests cannot
cover at all.

## Decisions made (grilled — do not re-litigate without a load-bearing reason)

- **Target is `next@16.2.12`** (current `latest`), not 15.x. 15 is a waypoint with no
  breaking change that affects this codebase.
- **React 19 ships as a separate phase, after Next 16 is deployed** — not bundled with
  it, not skipped. Next 16's peer range still permits `react@^18.2.0`, and Pages Router
  support for React 18 has been explicit Next.js policy since 15, so React 18 on Next 16
  is a supported configuration and a legitimate resting point between phases.
- **Turbopack is adopted as the default for dev and build**, not opted out of with
  `--webpack`. There is no custom webpack config to migrate, and Netlify's v5 runtime
  supports Turbopack builds.
- **ESLint 9, not 10.** ESLint 10 is `latest`, and `eslint-config-next@16`'s peer range
  (`>=9.0.0`) nominally permits it, but Next's own docs frame v10 as the thing flat
  config is *preparing* for rather than something the plugin is tested against. ESLint
  10 is a follow-up, not part of this upgrade.
- **Flat config replaces `.eslintrc.json` in Phase 1**, before the Next bump, so that
  ESLint-rule churn and Next-version churn never appear in the same failing run.
- **`.node-version` goes to `22`**, matching CI and local dev, not to the bare `20.9.0`
  minimum. There is no reason to have Netlify on a different major from everything else.
- **`reactStrictMode: true` stays.** CLAUDE.md documents real dev-only fallout from it;
  that's a known, understood rough edge, not a reason to disable a production-correctness
  setting during an upgrade.
- **The `@next/codemod upgrade` CLI is not used as the mechanism.** Every change it would
  make is enumerated above and is a handful of lines; running an interactive codemod
  across a repo where none of the target APIs are in use adds noise and obscures the diff.

## Explicitly out of scope

- **Migrating to the App Router.** Unrelated, far larger, and nothing in this upgrade
  forces it — Pages Router is fully supported in Next 16.
- **Adopting Next 16 features**: `cacheComponents`/PPR, `reactCompiler`, `next/form`,
  Turbopack filesystem caching (`experimental.turbopackFileSystemCacheForDev`). Each is
  a separate opt-in decision with its own testing burden.
- **ESLint 10**, and any rule-set expansion beyond preserving today's effective config.
- **Converting `next.config.js` to `next.config.ts`.** Supported since 15, unrelated.
- **Unrelated dependency bumps.** `openai`, `@tanstack/react-query`, `vitest`,
  `playwright` etc. are not part of this change even where newer versions exist.
- **The Go API, migrations, and anything under `netlify-functions/`.** Untouched by a
  frontend framework upgrade; `build.sh`'s Go steps and OpenAPI drift checks should
  pass unchanged.

## Things to get right when building this

- **`.node-version` is the deploy-breaker.** Every local and CI check runs Node 22
  already, so an un-bumped `.node-version` produces a clean local run and a failed
  Netlify build. Bump it in Phase 1, before anything depends on it.
- **`npm run lint` failing is a Netlify *build* failure, not just a CI one.**
  `netlify.toml`'s build command is `./build.sh`, which starts with `npm run package`
  (`lint && typecheck && build`). The `next lint` → `eslint .` switch is not cosmetic.
- **`eslint .` needs explicit ignores.** `next lint` implicitly scoped itself; bare
  `eslint .` will walk `.next/`, which contains compiled copies of the `pages/api`
  test files. `vitest.config.js` has a comment explaining that same trap.
- **Peer-dependency warnings during Phase 2's install are expected and should be read,
  not blanket-suppressed with `--legacy-peer-deps`.** On React 18 with Next 16
  everything in the tree resolves cleanly; if npm complains, something in the plan is
  wrong and the message is the signal.
- **Auth0 v2 is invisible to the test suite.** `DISABLE_AUTH=true` means the e2e suite,
  `dev:full`, and every Vitest test run against `useMockAuth0`. Phase 4 is not done
  until someone has logged in against the real tenant.
- **Run the full e2e suite, not just Vitest, at Phase 2's gate.** Per CLAUDE.md, the
  Playwright suite is what catches regressions at the real API boundary. Note that
  `test:e2e` tears down its own containers with `--volumes` first — if another
  worktree's compose project is running, confirm which stack you're actually hitting
  (`docker inspect <container> --format '{{range .Mounts}}{{.Source}}{{end}}'`).
- **`next dev` now writes to `.next/dev`**, separate from `next build`'s output, and a
  lockfile prevents two `next dev` instances on the same project. Nothing in
  `scripts/dev-full.sh`, `playwright.config.ts` or `netlify.toml` reads `.next` paths
  directly (only `publish = ".next"`, which is build output), so no change is expected —
  but the lockfile is a new failure mode if a stale dev server is left running.
- **`swagger-ui-react` is the one dependency worth watching under Turbopack.** It's a
  large, CJS-heavy package whose CSS is imported globally from `pages/_app.tsx`. Nothing
  suggests it breaks, but if the Phase 2 build fails in a way that isn't explained by
  anything above, this is the first place to look — and `pages/dev/api-docs.tsx` is
  dev-only, so worst case it can be isolated rather than blocking the upgrade.
