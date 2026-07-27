# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Big Shop is a recipe management and meal planning app: a Next.js 14 / React 18 frontend with Auth0 auth, a Go API backend deployed as AWS Lambda via Netlify Functions, and a TiDB (MySQL-compatible) database.

- **What this product is** (Account, Recipe, Shopping List, and the rest of the domain vocabulary) → [CONTEXT.md](./CONTEXT.md)
- **How it's built** (DB schema, API routes, component structure, hooks, deployment, dependencies) → [technical-architecture.md](./technical-architecture.md)

## How to run and test the app

### Frontend Development
```bash
npm run dev          # Start Next.js development server
npm run dev:full     # docker compose (local MySQL + Go API) + Next.js, one command
npm run build        # Build production frontend
npm run start        # Start production server
npm run lint         # Run ESLint
npm run typecheck    # Run tsc --noEmit
npm run package      # Lint, typecheck, and build (used in deployment)
```

### Full Stack Development
```bash
./build.sh                  # Build frontend + run Go tests (production build).
                             # This is Netlify's actual build command (netlify.toml),
                             # run in a sandbox with Go provisioned natively - no
                             # Docker available there. Requires Go installed locally
                             # to run this yourself.
./scripts/build-local.sh    # Same checks, for machines without Go installed: runs
                             # the Go steps (fmt/test/openapi-drift-check) inside the
                             # api container's Go toolchain via docker compose instead.
                             # Local dev only - not what Netlify runs.
```

### Local Development Setup

**Fastest path — full local stack:** `npm run dev:full` (needs Docker running).
This runs `scripts/dev-full.sh`, which:
- Brings up `docker-compose.yml`'s `db` (MySQL 8, seeded once on first run from
  `migrations/*.sql` + `docker/mysql-seed/dev-seed.sql` via
  `docker/mysql-init/01-migrate-and-seed.sh`) and `api` (the Go binary's `dev`
  mode, `DISABLE_AUTH=true`, hot-reloaded with `air` — edit any `.go` file and
  it rebuilds automatically) services.
- Waits for the API's `/health` endpoint, then runs Next.js natively on the
  host (not dockerized — keeps fast refresh) on port 3001 by default.
- Ports are overridable if they clash with another checkout/worktree:
  `DB_PORT`, `API_PORT`, `WEB_PORT` env vars (see the script for defaults).
- The seeded dev user is `local-dev-user`, already linked to account id 1
  (the account `migrations/008_user.sql` creates on a fresh DB), with two
  sample recipes. `docker compose down -v` wipes the DB volume, so the next
  `npm run dev:full` reseeds from scratch.

This gives real read/write behavior against an actual DB — no mocks, no
special-casing in the frontend hooks — closest thing to prod available
locally.

**Multiple worktrees — isolate the docker compose project.** Docker Compose
derives its project name from the directory basename by default, and every
worktree of this repo is checked out into a directory named `big-shop`. That
means running plain `docker compose` commands (`up`, `ps`, `exec`, `restart`,
`logs`...) from a second worktree doesn't spin up isolated containers — it
silently finds and operates on the *other* worktree's already-running
containers, DB included, regardless of the `DB_PORT`/`API_PORT` overrides
above (those only avoid port-binding conflicts; they don't change which
project/containers compose resolves to). `docker inspect <container>
--format '{{range .Mounts}}{{.Source}}{{end}}'` shows which worktree's
source a running container is actually bind-mounted to if there's ever any
doubt. To get a genuinely separate stack when working from a non-primary
worktree, set an explicit project name and non-colliding ports, e.g.:
```bash
COMPOSE_PROJECT_NAME=bigshop-<worktree-name> DB_PORT=3309 API_PORT=8081 \
  docker compose up -d db api
```
Tear it down the same way (`COMPOSE_PROJECT_NAME=... docker compose down -v`)
when done — don't run bare `docker compose down`/migrations/`exec` against
whatever project happens to already be running unless you've confirmed via
`docker inspect` that it's actually this worktree's stack.

**Faster-but-shallower path — JSON mocks, no backend at all:**
1. In `.env.local`, set:
   - `NEXT_PUBLIC_DISABLE_AUTH=true` — both `pages/_app.js` and every consumer of
     `hooks/use-auth.js` (a thin wrapper around `@auth0/auth0-react`'s `useAuth0`)
     resolve to a fixed mock user instead of mounting the real `Auth0Provider`.
     Must be `NEXT_PUBLIC_`-prefixed — Next.js strips non-prefixed env vars from
     the client bundle, so an unprefixed flag only takes effect during SSR and
     causes a hydration mismatch (this bit us once: `/list` would flash its
     content then get redirected back to `/`).
   - `NEXT_PUBLIC_USE_MOCKS=true` — serves canned data from `mocks/*.json`
     instead of calling the Go API, for `/recipes`, `/list`, and the new-recipe
     form's unit dropdown and tag picker. Mutations (save/delete recipe,
     invites, account) still hit the real API even with mocks on.

     There is no ingredient autosuggest, and no `mocks/ingredients.json`. The
     canonical Ingredient/Unit names that Recipe Import feeds the model — the
     list that stops it coining a second name for something the catalog
     already has — are read from the database inside the API routes, by
     `lib/recipe-import/known-names.ts`, on every request. The client is not
     asked for them and cannot override them, in any mode. That means import
     under mocks still canonicalises against real data, which matters because
     saving hits the real API even with mocks on, so a mock-mode import writes
     genuine rows.

2. `npm run dev` — no Docker, no DB, no Go API needed at all.

**Manual path** (what `dev:full` automates, useful if you want the API/DB
outside Docker): `go run . dev` inside `netlify-functions/recipes/` starts a
plain HTTP server on `:8080` — but routes are always registered under
`/.netlify/functions/recipes` (see `main.go`'s `GetRouter` call), so
`NEXT_PUBLIC_API_HOST` must include that suffix, e.g.
`http://localhost:8080/.netlify/functions/recipes` (already the case in
`.env.development`). It needs a live DB via `DSN`, and `DISABLE_AUTH=true`
(no `NEXT_PUBLIC_` prefix — read server-side by the Go process) to skip real
Auth0 JWT validation; the router then injects a fixed `DEV_USER_ID` (default
`local-dev-user`) as the request's user ID, which must exist in `account_user`
in your DB for requests to resolve to an account. Without `DISABLE_AUTH`, the
Go server validates JWTs against the real Auth0 tenant
(`AUTH0_DOMAIN`/`AUTH0_AUDIENCE`) — impractical for local-only work.

**Known rough edge (dev-only):** `next.config.js` has `reactStrictMode: true`,
which double-invokes effects in development. Combined with `use-http`'s
abort-on-unmount behavior (it registers `request.abort` as the cleanup of a
mount effect, aborting whatever's in flight on that hook instance — see
`useFetch.js`'s `useEffect(() => request.abort, [])`), Strict Mode's
first-pass effect fires its requests, then its cleanup immediately aborts
them, before the second pass fires the real ones. A hard page reload on
`/recipes`, `/recipes/[id]`, or `/list` can occasionally render empty if the
aborted first call's state resolves after the real one. Client-side `<Link>`
navigation is unaffected in practice. Doesn't happen in production (Strict
Mode's double-invoke is a dev build only). Not something this setup work
fixed — the real-API path was never previously exercised locally, so this
was never observable before.

Where a component fires multiple concurrent requests off one shared
`useFetch` instance, this is worse than "occasionally empty": each call's
own resolved value (`undefined` if aborted) is the only reliable per-call
signal — the hook's single `response`/`error` is shared across every call on
that instance, so it reflects whichever call last updated it, not each one
individually, and gating multiple `setState`s behind one `response.ok` check
can update state from a *different* call than the one just aborted. This bit
`components/recipe-form/Form.tsx`'s `getUnitsTagsAndIngredients` in
practice — deterministically, every dev load, not just occasionally — since
it fired three concurrent `get()`s and gated all three `setState`s on one
shared `response.ok`, crashing with `Cannot read properties of undefined
(reading 'map')` when Strict Mode's first pass got aborted but a *later*
call (from the second pass) had already flipped the shared `response.ok` to
true by the time the first pass's own check ran. Fixed by checking each
result for `undefined` individually instead of gating on `response.ok` —
the general lesson for any future concurrent-call-on-one-instance code here.

**Environment variables:**
- Copy from `.env.development` for local development
- Auth0 credentials required for authentication flow (unless `DISABLE_AUTH`/`NEXT_PUBLIC_DISABLE_AUTH` set)
- `OPENAI_API_KEY` required for AI features
- `SENDGRID_API_KEY` required for email invitations
- Full reference table (dev/prod/server-side secrets) → [technical-architecture.md](./technical-architecture.md#environment-variables)

### Testing

Go API tests:
```bash
cd netlify-functions/recipes
go test ./... -v
```

Frontend unit/component tests (Vitest + React Testing Library):
```bash
npm run test         # run once
npm run test:watch   # watch mode
```
Config is `vitest.config.js`. Components/hooks/tests in this codebase are
TypeScript (`.tsx`/`.ts`, see `follow-ups.md` #9). Test files live next to
the file under test (e.g. `components/button/index.test.tsx`,
`hooks/use-page-visibility.test.ts`) — see those two for the established
pattern.

End-to-end tests (Playwright):
```bash
npm run test:e2e         # headless, fast - what CI/normal validation should use
npm run test:e2e:debug   # headed, slowed down (E2E_SLOWMO) - for stepping through a scenario visually
```
Config is `playwright.config.ts`; specs live in `e2e/` (`recipe.spec.ts`,
`shopping-list.spec.ts`), with its own scoped `e2e/tsconfig.json` separate
from the root `tsconfig.json`.
Requires Docker: `webServer` in the config auto-starts `npm run dev:full`
against pinned ports with its own `COMPOSE_PROJECT_NAME=bigshop-e2e`, so it
won't collide with another worktree's stack; `test:e2e`/`test:e2e:debug` both
run `test:e2e:stop` first to tear down any containers left over from an
interrupted previous run (otherwise `dev-full.sh`'s own auto-increment-on-
collision port logic silently drifts to different ports than the ones pinned
in `e2e/env.ts`).

**`test:e2e:stop` passes `--volumes`, so every run starts from a freshly
migrated and seeded database.** That matters more than it sounds: MySQL only
runs `docker-entrypoint-initdb.d` (and therefore `migrations/*.sql`) when the
data directory is *empty*, so a persisted volume silently pins the e2e database
to whatever schema existed when it was first created. Without `--volumes`, add a
migration and the e2e suite keeps running against the old schema — failing in
ways that look like application bugs (every shopping-list request 500s on a
missing column, so the list just renders empty) rather than like a stale
environment. It also stops fixture recipes accumulating across runs, which they
did, for months, because teardown deletes fail silently (follow-ups.md #24).

The suite covers the core Recipe CRUD and Shopping List flows (add/edit/delete a
Recipe; add/remove a Recipe on the list, add an Extra Item, mark/un-mark an item
bought, clear the list), plus all three Recipe Import Sources in
`e2e/recipe-import.spec.ts`. Dave and tag-filter browsing remain out of scope.

**Import is covered without any LLM call**: Playwright intercepts the Next.js
API routes (`/api/parse-recipe-url`, `/api/parse-recipe-text`,
`/api/recipe-image` and its polling request) and returns canned JSON. That
exercises every line between the extractor and the save payload, which is where
the bugs have actually been — two Phase 4 defects lived there and no test caught
either. All three Sources are covered rather than one because they use two
different code paths (Manual Entry's paste box goes through
`appendIngredients`; URL and Photo set `initialRecipe`), and the last bug was
present in two of the three.

**A spec that touches the Shopping List must not run alongside
`shopping-list.spec.ts`.** Under `DISABLE_AUTH` the list is one mutable resource
shared by the whole account, and Playwright runs spec *files* in parallel —
`shopping-list.spec.ts` guards itself with serial mode within its own file, but
nothing stops another file stomping it. `recipe-import.spec.ts` therefore
asserts on the captured save payload rather than on the rendered list. Run this whenever a change touches
recipe creation/editing/deletion or shopping-list behavior — Vitest alone
won't catch a regression that only shows up going through the real API
(e.g. a mismatched request content-type, as `follow-ups.md` #12 notes was
caught this way).

Also runs in CI via `.github/workflows/e2e.yml` on every pull request
(plus manual `workflow_dispatch`): same `npm run test:e2e` command, on a
fresh `ubuntu-latest` runner, so it needs no secrets — `.env.development`'s
committed defaults (`NEXT_PUBLIC_DISABLE_AUTH=true` etc.) are enough to bring
the stack up standalone. `reporter` in `playwright.config.ts` adds an HTML
report under `CI` (plain `list` isn't useful without a terminal to scroll
back through); the workflow uploads it, plus any failure traces, as build
artifacts. Not yet wired up as a required check — see follow-ups.md #13.

Evals:
```bash
npm run test:evals   # runs evals/run-evals.sh
```

## Useful External Links

- [Netlify Dashboard](https://app.netlify.com/sites/big-shop/overview)
- [TiDB Console](https://tidbcloud.com/console/clusters/10445360365857932862/sqleditor?orgId=1372813089209222715&projectId=1372813089454538934)
- [Auth0 Management](https://manage.auth0.com/dashboard/eu/dev-x-n37k6b/applications/HxkTOH3ZYxjbsgrVI4ii1CV2TQx7hk9G/settings)
- [Trello Backlog](https://trello.com/b/LnaGkQyG/bigshop)
