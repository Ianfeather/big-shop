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
npm run package      # Lint and build (used in deployment)
```

### Full Stack Development
```bash
./build.sh           # Build frontend + run Go tests (production build)
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
     form's ingredient/unit/tag autosuggest. Mutations (save/delete recipe,
     invites, account) still hit the real API even with mocks on.
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
abort-on-unmount behavior, a hard page reload on `/recipes`, `/recipes/[id]`,
or `/list` can occasionally render empty if the aborted first call's state
resolves after the real one. Client-side `<Link>` navigation is unaffected in
practice. Doesn't happen in production (Strict Mode's double-invoke is a dev
build only). Not something this setup work fixed — the real-API path was
never previously exercised locally, so this was never observable before.

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

Evals:
```bash
npm run test:evals   # runs evals/run-evals.sh
```

## Useful External Links

- [Netlify Dashboard](https://app.netlify.com/sites/big-shop/overview)
- [TiDB Console](https://tidbcloud.com/console/clusters/10445360365857932862/sqleditor?orgId=1372813089209222715&projectId=1372813089454538934)
- [Auth0 Management](https://manage.auth0.com/dashboard/eu/dev-x-n37k6b/applications/HxkTOH3ZYxjbsgrVI4ii1CV2TQx7hk9G/settings)
- [Trello Backlog](https://trello.com/b/LnaGkQyG/bigshop)
