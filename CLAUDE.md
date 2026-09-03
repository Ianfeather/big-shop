# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Big Shop is a recipe management and meal planning app: a Next.js 16 / React 19 frontend with Auth0 auth, a Go API backend deployed as AWS Lambda via Netlify Functions, and a TiDB (MySQL-compatible) database.

- **What this product is** (Account, Recipe, Shopping List, and the rest of the domain vocabulary) → [CONTEXT.md](./CONTEXT.md)
- **How it's built** (DB schema, API routes, component structure, hooks, deployment, dependencies) → [technical-architecture.md](./technical-architecture.md)
- **Known issues we don't plan to fix** (investigated, judged not worth acting on — check here before chasing a surprising error) → [known-issues.md](./known-issues.md)
- **What's queued, in flight and shipped** (the ticketing system — it is not in this repo) → [the bigshop Notion board](https://app.notion.com/p/87fae8a2ed054f2c874201e827639bd8), and "Tracking work" below

**Analytics and consent.** `/privacy` is the published policy and `lib/consent.ts`
holds the decision; nothing non-essential loads without one. Two rules bite when
touching anything nearby: a page title sent to Google comes from
`lib/analytics/page-titles.ts`'s static per-route map and **never** from
`document.title` (a test reads the `pages/` directory, so a new route without an
entry fails), and an analytics event is added only when answering its question
needs more than Grafana's 14-day retention — otherwise it is a metric. Both are
argued in [ADR-0008](./docs/adr/0008-what-telemetry-does-not-carry.md) §1 and
`lib/analytics/events.ts`.

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
./build.sh                  # Netlify's build command (netlify.toml). Builds the
                             # Next.js site and nothing else - it is now just
                             # `npm run package`.
./scripts/build-local.sh    # The full local check suite: `npm run package` plus the
                             # Go steps (gofmt/vet/test + both drift checks) that
                             # .github/workflows/ci.yml's `go` job runs in CI. Runs
                             # them inside the api container's Go toolchain via docker
                             # compose, so it needs Docker but not Go on the host.
```

**`build.sh` no longer runs the Go checks.** `go fmt`, `go test` and the
`openapi.yaml`/`api.d.ts` drift checks used to live there, which meant they ran
**only** inside Netlify's deploy build. They now live in `ci.yml`'s `go` job,
which runs on every pull request *and* on pushes to `master`. The Go API is
deployed to Fly.io by `.github/workflows/deploy-api.yml`, not by Netlify — see
[ADR-0006](./docs/adr/0006-go-api-leaves-netlify-functions.md).

### Database migrations

**Migrations reach production through the deploy, not by hand.** `deploy-api.yml`
runs `scripts/migrate-prod.sh` immediately before `flyctl deploy`; it applies
every file in `migrations/` that the database has not recorded in its
`schema_migration` ledger, and a failure fails the job so nothing ships against
a schema that would not take it.

Writing one is therefore just: add `NNN_name.sql` to `migrations/`, open a PR,
merge. Locally, a fresh volume replays the lot and writes the ledger itself, and
`npm run dev:full` repairs a volume that is merely behind.

Three rules the runner enforces, each of which fails loudly rather than
guessing:

- **Never edit an applied migration.** The ledger stores each file's SHA-256 and
  the runner stops if one has changed since it ran. Correct a mistake with a new
  migration — the old file is a record of what the database actually had done to
  it.
- **Never renumber below the high-water mark.** A `043` merged after `044` has
  already run would build a schema no fresh database passes through, so the
  runner refuses it and asks for a renumber. This is the one that bites when two
  branches both add the same number.
- **A destructive migration is two releases.** Migrating *before* deploying keeps
  the schema ahead of the code, which is the right way round for adding
  anything; it does mean the old code briefly runs against the new schema. So
  ship the code that stops using a column first, and drop the column in a later
  release.

`scripts/migrate-prod.sh --dry-run` says what is pending against production
without applying it, and needs no Go installed: it runs the pinned toolchain in
a container (a plain `docker run`, not `docker compose` — compose would resolve
to whichever worktree's project the directory implies and would start the local
`db` this has no use for). `MIGRATE_GO=host` uses the host's `go` instead, which
is what the deploy workflow does because `setup-go` has already put the pinned
version there. For a local database, `go run . migrate --dry-run` from
`netlify-functions/recipes` does the same thing directly. A database that predates the ledger — which
production did, once — has to be adopted with `--baseline <filename>` before the
runner will touch it; it refuses to guess, and says so at length.

This exists because it did not: on 2026-08-27 #133 shipped a query selecting
`recipe.featured` while migration 042 that adds the column sat unapplied, and
`GET /recipe/{id}` answered 500 for a day. No suite could have caught it —
every environment a test runs in builds its schema from `migrations/*.sql` at
the same commit as the code, so production was the only one that could drift and
the only one with no record of what it had.

### Local Development Setup

**Fastest path — full local stack:** `npm run dev:full` (needs Docker running).
This runs `scripts/dev-full.sh`, which:
- Brings up `docker-compose.yml`'s `db` (MySQL 8, seeded once on first run from
  `migrations/*.sql` + `docker/mysql-seed/dev-seed.sql` via
  `docker/mysql-init/01-migrate-and-seed.sh`) and `api` (the Go binary's
  `serve` mode — the same one the production container on Fly runs —
  `DISABLE_AUTH=true`, hot-reloaded with `air` — edit any `.go` file and
  it rebuilds automatically) services.

  **A failing migration now makes the `db` container unhealthy rather than
  silently incomplete.** The replay runs `mysql --force`, which skips just the
  failing statement and still exits 0 — so a broken migration used to leave a
  hole in the schema behind a container reporting Healthy, and the first
  symptom was an application-looking 500. Every error is now reconciled against
  `docker/mysql-init/expected-migration-errors.txt`, which lists the handful of
  early statements that genuinely cannot apply to an empty schema and says why
  for each. Anything else sets `bigshop._migration_status.ok = 0`, and the
  healthcheck reads that row, so `api` never starts against the result.

  The verdict is a row rather than an exit code on purpose: a non-zero exit
  kills the container, `restart: unless-stopped` brings it straight back, and
  the entrypoint skips the init scripts on that second start because the data
  directory is no longer empty — producing a Healthy container with exactly
  the broken schema the check rejected. **Fixing the migration is not enough
  on its own for the same reason: the replay only runs against an empty data
  directory, so the volume has to be recreated** — which `npm run dev:full`
  now does for you (below).

  **A volume that is merely *behind* is repaired automatically, and you should
  never need to run `docker compose down -v` by hand.** The replay above runs
  exactly once in a volume's life, so it could not catch this: `ok = 1` is a
  statement about the day the volume was created and stays 1 forever, meaning
  a volume that predates a migration reported Healthy while serving a schema
  with holes in it. The symptom was an application-looking 500, not a schema
  error.

  Two things now close that. The init script records *which* migrations it
  replayed in `schema_migration` — one row per file, the same ledger
  `internal/pkg/migrate` and the production database use — and the healthcheck
  compares those rows against `./migrations` (bind-mounted into the container)
  on every check, so
  `api` refuses to start against a stale schema through the same mechanism
  that already protects it from a broken one. And `scripts/ensure-db-current.sh`
  — run by `dev-full.sh` before anything waits on health, and by
  `sync-from-prod.sh` before it imports — *repairs* the drift rather than
  reporting it: it dumps the volume's data out of the running container, drops
  the volume, lets the init path replay and seed, and restores the data. On a
  volume that is already current it is one `SELECT` and prints nothing.

  The premise is that **the dev database volume is a cache, not a store of
  record**: everything in it is reconstructible from `migrations/*.sql`,
  `docker/mysql-seed/dev-seed.sql` and a dump on the host. `sync-from-prod.sh`
  already worked this way — it truncates and reimports on every run, and its
  `--no-create-info --complete-insert` exists precisely so production's rows
  can land in a *local* schema that is ahead of production.

  **The one case that still needs you** is a migration that rewrites rows
  rather than schema (`022`, `023`, `029`, `031` are of this kind). The
  restore puts your old rows back as they were, so a fixup that migration
  would have applied stays unapplied locally. The script warns when it sees
  one, and the fix is `scripts/sync-from-prod.sh` — production has had the
  migration applied properly. If the restore fails outright (a new column or
  constraint the old rows cannot satisfy) the database is rebuilt clean, and
  the dump is kept and named so nothing is lost.
- Brings up `lgtm` (`grafana/otel-lgtm` — Collector, Tempo, Loki, Prometheus
  and Grafana in one image), the local stand-in for the Grafana Cloud stack.
  Grafana is on **3200**, not 3000 — the web app keeps 3000. The API exports
  to it over the compose network at `lgtm:4318`; Next.js runs on the host, so
  `dev-full.sh` points it at the published `OTLP_HTTP_PORT` instead. Neither is
  ever blocked on it being up. Opt out with `START_LGTM=false`, which is what
  the e2e suite does (see below). See
  [ADR-0007](./docs/adr/0007-observability-otel-grafana-cloud.md).

  **Restarting the `lgtm` container means restarting `next dev` too.** The
  Netlify-side exporter has a circuit breaker that stops flushing after three
  consecutive failures for the rest of the *container's* life, relying on
  container churn to reset it — right for a Lambda, wrong for a dev server that
  lives for hours. A restart of LGTM trips it, and the symptom is silence:
  traces already exported, nothing new, nothing logged.
- Waits for the API's `/health` endpoint, then runs Next.js natively on the
  host (not dockerized — keeps fast refresh) on port 3000 by default.
- Ports are overridable if they clash with another checkout/worktree:
  `DB_PORT`, `API_PORT`, `WEB_PORT`, `GRAFANA_PORT`, `OTLP_HTTP_PORT` env vars
  (see the script for defaults).
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

This applies to the **dev** stack only. The e2e stack derives its own
per-worktree project name and ports and needs none of it — see "End-to-end
tests" below.

**There is no mocks mode.** `NEXT_PUBLIC_USE_MOCKS` and `mocks/*.json` are gone
— `npm run dev:full` made them redundant, and they had started to mislead: the
mock Shopping List reimplemented ingredient combining, incorrectly and by its
own admission, right through the work that made real combining correct. Run
against the real stack, or against a synced copy of production
(`scripts/sync-from-prod.sh`).

**Manual path** (what `dev:full` automates, useful if you want the API/DB
outside Docker): `go run . serve` inside `netlify-functions/recipes/` starts a
plain HTTP server on `:8080` — the same mode the production container on Fly
runs, which is why it is no longer called `dev` (`dev` still works as an alias).
Routes are registered under
`/api/bigshop` (`main.go`'s `basePath`, passed to `GetRouter`), so
`NEXT_PUBLIC_API_HOST` must include that suffix, e.g.
`http://localhost:8080/api/bigshop` (already the case in
`.env.development`). It needs a live DB via `TIDB_HOST`, `TIDB_PORT`,
`TIDB_USER`, `TIDB_PASSWORD` and `TIDB_DB` — `dsn.go` builds the connection
string from those, and refuses to start naming any that are missing rather than
connecting somewhere half-configured (leave `TIDB_TLS` unset for a local
database; it is `true` only for TiDB Cloud). It also needs `DISABLE_AUTH=true`
(no `NEXT_PUBLIC_` prefix — read server-side by the Go process) to skip real
Auth0 JWT validation; the router then injects a fixed `DEV_USER_ID` (default
`local-dev-user`) as the request's user ID, which must exist in `account_user`
in your DB for requests to resolve to an account. Without `DISABLE_AUTH`, the
Go server validates JWTs against the real Auth0 tenant
(`AUTH0_DOMAIN`/`AUTH0_AUDIENCE`) — impractical for local-only work.

**Historical note (no longer a live issue):** this section used to document a
dev-only rough edge where `reactStrictMode: true`'s double-invoked effects
collided with `use-http`'s abort-on-unmount behaviour, so a hard reload of
`/recipes`, `/recipes/[id]` or `/list` could render empty, and
`components/recipe-form/Form.tsx` crashed deterministically on
`Cannot read properties of undefined (reading 'map')` when three concurrent
`get()`s shared one `useFetch` instance's single `response.ok`.

`use-http` has since been removed in favour of TanStack Query, which owns
per-query state rather than sharing one `response`/`error` across every call on
a hook instance, so neither symptom applies any more. The transferable lesson
does: **when several concurrent calls share one hook instance, each call's own
resolved value is the only reliable per-call signal** — never gate several
`setState`s on one shared success flag, because it may have been set by a
different call than the one you are handling.

**Environment variables:**
- Copy from `.env.development` for local development
- Auth0 credentials required for authentication flow (unless `DISABLE_AUTH`/`NEXT_PUBLIC_DISABLE_AUTH` set)
- `OPENAI_API_KEY` required for AI features
- `SENDGRID_API_KEY` required for email invitations
- `NEXT_PUBLIC_GA_MEASUREMENT_ID` enables Google Analytics. Unset everywhere but
  production, and **unset there too until someone deliberately sets it** — its
  absence means no tag is loaded and no request reaches Google, which is what a
  laptop, a deploy preview and CI all get. Even with it set, nothing loads until
  a visitor accepts analytics.
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
TypeScript (`.tsx`/`.ts`, see board item #9). Test files live next to
the file under test (e.g. `components/button/index.test.tsx`,
`hooks/use-page-visibility.test.ts`) — see those two for the established
pattern.

**One exception: a test colocated under `pages/` must be named `*.test.mts`,
not `*.test.ts`.** Next.js treats *every* file under `pages/` as a route if its
extension is in `pageExtensions` (`tsx`/`ts`/`jsx`/`js`), and a test file has no
default export, so from Next 16 onwards it fails the build outright:

```
Type 'typeof import(".../pages/api/parse-recipe-url.test")' does not satisfy
the constraint 'ApiRouteConfig'. Property 'default' is missing
```

`.mts` is not in `pageExtensions`, so Next ignores those files entirely, while
Vitest still matches them by default (`**/*.{test,spec}.?(c|m)[jt]s?(x)`). See
`pages/api/parse-recipe-url.test.mts`. `tsconfig.json`'s `include` carries a
`pages/**/*.mts` entry so they stay type-checked.

Before Next 16 this misconfiguration was silent rather than fatal — the test
files were compiled and deployed as real (broken, unreachable) serverless
functions. The same applied to any non-route helper module under `pages/api/`,
which is why `lib/dave/tools.ts` lives in `lib/` rather than next to the route
that uses it. **Put helper modules for an API route in `lib/`, never alongside
it under `pages/api/`.**

End-to-end tests (Playwright):
```bash
npm run test:e2e         # headless, fast - what CI/normal validation should use
npm run test:e2e:debug   # headed, slowed down (E2E_SLOWMO) - for stepping through a scenario visually
```
Config is `playwright.config.ts`; specs live in `e2e/` (`recipe.spec.ts`,
`shopping-list.spec.ts`), with its own scoped `e2e/tsconfig.json` separate
from the root `tsconfig.json`.
Requires Docker: `webServer` in the config auto-starts `npm run dev:full` on a
stack whose identity — compose project name and all three ports — is derived
per worktree by `e2e/instance.cjs`. `test:e2e`/`test:e2e:debug` both run
`test:e2e:stop` first to tear down any containers left over from an interrupted
previous run.

**Every e2e stack is per-worktree, and that is load-bearing rather than tidy.**
This section used to say the pinned `COMPOSE_PROJECT_NAME=bigshop-e2e` stopped
the e2e stack colliding with another worktree's. It stopped it colliding with a
*dev* stack, and did the exact opposite for a second e2e run: every worktree
resolved to the same project, so the same containers and the same volumes. And
because `test:e2e` *begins* with `test:e2e:stop` — `docker compose down
--remove-orphans --volumes` — starting a run in one worktree tore another
worktree's in-flight run down mid-suite, database included. From the other side
that is invisible: containers vanish and specs fail in ways that read exactly
like application bugs, which quietly falsified the "a flaky-looking e2e failure
gets investigated, not re-run-until-green" rule below whenever a second
worktree existed.

So `e2e/instance.cjs` hashes the worktree path into a project name
(`bigshop-e2e-4-big-shop-442f25` — the slug is readable, the digest is what
makes it unique) and a 0–99 offset picking one port from each of three blocks:
web `3900+`, DB `4200+`, API `8980+`. It is automatic on purpose; the failure it
prevents was silent, so a convention to remember would not have held. Nothing
reads a hardcoded name any more — `e2e/env.ts` imports the module,
`test:e2e:stop` and `.github/workflows/e2e.yml`'s log dump both go through
`scripts/e2e-compose.sh`, which asks it for the project name. **Adding another
`docker compose` call against the e2e stack means calling that wrapper, not
writing the name out.** CI is unaffected either way: one checkout per runner.

The two escape hatches, for the rare case where two worktrees hash to the same
offset:
- `E2E_INSTANCE=<name>` overrides the derived identity for both the project
  name and the ports.
- `PIN_PORTS=true` (which `playwright.config.ts` sets) makes `dev-full.sh` fail
  loudly on a port already in use instead of auto-incrementing to the next free
  one. That fallback is right for `npm run dev:full` and wrong here: Playwright's
  `baseURL` and health-check URL are already fixed, so a drifting stack is one
  nothing is connected to, and the symptom is an unexplained health-check
  timeout. The failure message names both hatches.

**The e2e stack deliberately runs without telemetry.** `playwright.config.ts`
passes `START_LGTM=false` and an empty `OTEL_EXPORTER_OTLP_ENDPOINT`, so
neither the LGTM container nor the OTel SDK inside the Go API starts. Nothing
in `e2e/` asserts on telemetry, and `grafana/otel-lgtm` is a ~1GB image whose
pull would be added to every CI run to prove nothing. ADR-0007's "local LGTM
for dev and e2e" is about keeping Grafana Cloud credentials out of everything
but production, which holds either way.

**`test:e2e:stop` passes `--volumes`, so every run starts from a freshly
migrated and seeded database.** That matters more than it sounds: MySQL only
runs `docker-entrypoint-initdb.d` (and therefore `migrations/*.sql`) when the
data directory is *empty*, so a persisted volume silently pins the e2e database
to whatever schema existed when it was first created. Without `--volumes`, add a
migration and the e2e suite keeps running against the old schema — failing in
ways that look like application bugs (every shopping-list request 500s on a
missing column, so the list just renders empty) rather than like a stale
environment. It also stops fixture recipes accumulating across runs, which they
did, for months, because teardown deletes fail silently (board item #24).

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
(e.g. a mismatched request content-type, as board item #12 notes was
caught this way).

Also runs in CI via `.github/workflows/e2e.yml` on every pull request
(plus manual `workflow_dispatch`): same `npm run test:e2e` command, on a
fresh `ubuntu-latest` runner, so it needs no secrets — `.env.development`'s
committed defaults (`NEXT_PUBLIC_DISABLE_AUTH=true` etc.) are enough to bring
the stack up standalone. `reporter` in `playwright.config.ts` adds an HTML
report under `CI` (plain `list` isn't useful without a terminal to scroll
back through); the workflow uploads it, plus any failure traces, as build
artifacts.

**Three jobs are required checks and block merging into `master`.** The
`required checks` repository ruleset requires `build-lint-test` and `go` (both
from `ci.yml`) and `e2e` (from `e2e.yml`) to pass on every pull request.
Renaming any of them in its workflow file silently breaks the gate — the
ruleset matches on job name, and a check that never reports is not the same
as a check that fails. Update the ruleset in the same change.

`go` was added to the ruleset after the fact, and its absence was worse than a
missing gate while it lasted: `deploy-api.yml` keys off the whole `CI`
workflow's conclusion, so a red `go` job merged through the un-updated ruleset
stopped the API deploying while Netlify went on shipping the site from that
same commit — a frontend and an API drifting apart, with no red required check
anywhere to say so.

One thing the ruleset deliberately does *not* do: it is not "strict", so a
branch does not have to be up to date with `master` before merging — that
would mean rebasing on every unrelated push.

**A direct push to `master` is rejected, not merely ungated.** This file used
to claim the opposite — that because the ruleset does not require a pull
request, `git push origin master` bypassed both suites, and the gate was only
on merging. It isn't: required status checks apply to the push as well, so the
push is refused outright with

```
remote: - 2 of 2 required status checks are expected.
```

because no check has ever reported against that commit. The practical
consequence is that **every commit reaching `master` goes through a pull
request**, including a one-line fix and including commits already sitting on a
local `master` that was never pushed — those have to be carried in on a branch
like anything else.

Evals:
```bash
npm run test:evals   # runs evals/run-evals.sh
```

## Tracking work: the Notion board

**The [bigshop Notion board](https://app.notion.com/p/87fae8a2ed054f2c874201e827639bd8)
is the single source of truth for what is queued, in flight and finished.**
Reach it through the `notion` MCP server: the database is
`87fae8a2ed054f2c874201e827639bd8` and its data source (the one to create pages
under, and to query with SQL) is
`collection://f5066c26-2463-4017-a02d-c82c02eb23f3`.

Each row has three properties: **Item** (the title), **State**, and **Tags**.

**State** is one of

| State | Meaning |
| --- | --- |
| `backlog` | Filed, not designed. The default for anything newly noticed. |
| `spec written` | A spec exists under `specs/` and nothing has been built from it yet. |
| `in development` | **Claimed.** Someone is actively building it, and its title is prefixed `WIP `. Don't start it — see "Claim an item before you touch it" below. |
| `done` | Shipped. |

**Tags** is a multi-select, currently `blocked`, `needs answers` and
`future feature`. It answers a different question from State, and the
distinction is the whole point of having both: **State says how far an item has
got; a tag says why it is not moving.** A tagged item is almost always still
`backlog` — the tag is not a fifth state and must never be used as one.

| Tag | Meaning | What clears it |
| --- | --- | --- |
| `blocked` | Cannot be started until something *outside the item* happens: a fact must be established, or another item must land first. | The external thing happening. Nobody can clear it by deciding harder. |
| `needs answers` | Cannot be designed until a person decides something — a product call, a policy choice, a trade-off that isn't the implementer's to make. | Somebody answering. The work is a conversation, not an investigation. |
| `future feature` | Nothing is being waited on. Wanted, understood well enough to file, and deliberately not scheduled — usually because it was split off a smaller piece of work that shipped first. | Somebody choosing to do it. |

The first two are not interchangeable, and picking the wrong one sends the next
agent down the wrong path. `blocked` says *go and find something out, or wait*;
`needs answers` says *go and ask someone*. `future feature` is the odd one of
the three and is worth naming as such: it is the only tag that does **not**
report an obstruction. It says *this is fine, it is simply not now* — so read it
as a note to a planner rather than as a warning to an implementer, and do not
reach for it when what you mean is that something is stuck. They can legitimately co-exist on
one row, and an item can move from one to the other — #59 was `needs answers`
because the shared-Account erasure question was a product decision, and once
that was answered it acquired a dependency on #50 instead.

**A tag without a body note is close to useless.** Whichever you apply, the row
must also say, in prose, *what specifically* is being waited on and what would
resolve it. "Blocked" alone tells the next reader nothing they can act on.

**Adding a new tag value replaces the whole option list.** The MCP server's
`update_data_source` takes DDL, and `ALTER COLUMN "Tags" SET MULTI_SELECT(...)`
is a *replacement*, not an addition — omit an existing value and it is dropped
from the schema, silently taking it off every row that carried it. Always
restate every existing option alongside the new one, then re-query the rows
that had tags to confirm they survived.

The row's page body carries the write-up: what the problem is, what was
investigated, what was deliberately *not* done and why. That prose is the point
of the board — keep writing it at the length the thing deserves, the way the
entries migrated from `follow-ups.md` do. A one-line row is nearly worthless
three months later.

**Always set `State` explicitly when creating a row.** There is no default:
verified against this data source, a `notion-create-pages` call that omits
`State` produces a row whose State is **null**, not `backlog`. Notion's status
properties expose no default value the MCP server can set (`update_data_source`
takes DDL only), so nothing but this rule prevents it. A stateless row is not
lost — the Board view has `hideEmptyGroups: false`, so it appears in a "No
Status" column — but it is in none of the four real states and reads as a
mistake. If you find one, give it a state.

### Claim an item before you touch it

**Several agents work this repo, and the board is the only thing stopping two
of them building the same item twice.** A claim is not bookkeeping you do
afterwards — it is the first action of the work, taken **before the first line
of code, the first migration, or the first edit to a spec file.** An item you
are working on but have not claimed is invisible to everyone else, and the cost
lands on whoever picks it up next.

**1. Check it is free.** Before starting anything, read the row's State and
Tags:

```sql
-- via notion-query-data-sources, mode: sql
SELECT "Item", "State", "Tags" FROM "collection://f5066c26-2463-4017-a02d-c82c02eb23f3"
WHERE "Item" LIKE '%<the thing you are about to build>%'
```

If it is already `in development`, **stop and do not start it.** Someone else
holds it. Say so, and either pick a different item or ask the user — the one
thing not to do is start anyway because the branch looks quiet.

If it carries a **tag**, read the body before starting. `blocked` and `needs
answers` both mean the item was deliberately parked, and the body says by whom
and on what — starting anyway means either re-deriving something already known
to be unanswerable, or making a decision that was explicitly left to someone
else. Neither is a claim you can take on your own. If you believe the tag is
stale, say why and clear it deliberately; don't just ignore it.

**2. Claim it, in the same action, before working.** Two changes together:

- **State → `in development`.** This is the claim state whether you are
  building the thing or writing its spec — both are active work on the item,
  and both want other agents to keep off. Don't reach for `spec written` here:
  that describes a spec that *exists*, so setting it before you have written
  one is a claim disguised as a result.
- **Prefix the title with `WIP `**, e.g.
  `#41 — Backfill the Method…` becomes `WIP #41 — Backfill the Method…`.

The `WIP ` prefix is deliberate redundancy. State is invisible in a
`notion-search` result, in a page mention, and anywhere else only the title is
rendered — the prefix means a claimed item reads as claimed everywhere, not
just on the board.

**3. Say where the work is.** Put the branch name in the body as you claim, and
the PR link as soon as one exists. "Claimed" without "and here is the branch"
still leaves the next agent unable to tell live work from an abandoned claim.

**4. Release the claim when you stop — finished or not.** This is the half that
is easy to skip and the one that rots the board:

- **Built and merged** → State `done`, **strip the `WIP ` prefix**, and update
  the body to say what actually shipped, including anything the original
  framing got wrong. Several migrated entries do exactly this (#44, #49, #58)
  and they are the most useful rows on the board. **Not before the merge**: an
  open PR is not shipped, so the row stays claimed while it waits, and rule 5
  of "Shipping work" below carries the release as its fourth step.
- **Spec written, not yet built** → State `spec written`, **strip the `WIP `
  prefix**, link the spec from the body. The item is free again, and the next
  agent gets a designed thing to pick up.
- **Stopped without finishing** → put the State back where you found it,
  **strip the `WIP ` prefix**, and add a line to the body saying how far it got
  and what is on the branch. A claim left behind on abandoned work is a
  permanent lock, and it is worse than no claim at all because it looks
  deliberate.

### Everything else

- **Noticing something worth doing → create a row in `backlog`.** Don't add it
  to a markdown file, and don't leave it in a PR description.
- **Titles keep the `#N` prefix** for items that came from `follow-ups.md`, so
  the cross-references in the bodies (and in code comments, migrations and
  ADRs) still resolve. New items don't need a number. A `WIP ` claim prefix
  goes in front of the number, not after it.
- **A `spec written` row links its spec file** from the body.

**`follow-ups.md` and `follow-ups-resolved.md` are a frozen archive.** Every one
of their entries now lives on the board. They stay in the repo only because
migrations, ADRs, specs and code comments cite them by path — **do not add to
them, and do not edit them**. If an old entry needs correcting, correct the
Notion row.

`known-issues.md` is unaffected and is still the right place for a problem that
has been investigated and deliberately will not be fixed. That is a different
thing from a backlog item: nothing in `known-issues.md` is queued work.

## Shipping work: pull requests

These rules apply to **all** work in this repo, not just `/implement`. The
`implement` skill's step 5 is one caller of them; a one-off fix asked for in
conversation is another.

**1. Finishing a spec or a task means opening a PR.** Work is not done when the
code is written and the local tests pass — it is done when there is a PR open
against `master` for it. Don't stop at "committed on a branch" and wait to be
asked. This is not a stylistic preference: per the section above, a direct push
to `master` is *rejected*, so a PR is the only route the work can take. Branch
naming is free-form; `implement/<spec-slug>` is what the implement skill uses.

**2. A visual or user-visible change needs screenshots in the PR body.** If a
change alters anything a user can see — a component, a page, copy, a state, an
error message — the PR must show it, not just describe it. Drive the real
change in the app (the `run` skill, or `claude-in-chrome`) and capture the
state that proves it works, not just a page load. A pure-backend change with no
visible surface is exempt; don't manufacture a screenshot for something with
nothing to show. The mechanics — where captured files are committed, and why an
embedded image must use a commit-pinned `raw.githubusercontent.com` URL rather
than a relative path — are in
[`.claude/skills/implement/EVIDENCE.md`](./.claude/skills/implement/EVIDENCE.md);
follow it for any PR, whether or not the implement skill produced it.

**3. Poll the PR's checks and report back; debug any failure.** After opening a
PR, watch its checks to a conclusion rather than handing over a PR of unknown
state:

```bash
gh pr checks --watch            # blocks until every check concludes
gh run view <run-id> --log-failed   # the failing step's output
```

`build-lint-test`, `go` and `e2e` are all required and all must be green. A red
check is work still owed on the task: read the failure, fix the cause, push,
and watch again. Fix it rather than reporting it back as a question — go back
to the user only if the failure needs a decision that is genuinely theirs (a
product call, a deliberate behaviour change), and say precisely what failed and
what you tried. **A flaky-looking e2e failure gets investigated, not
re-run-until-green** — the suite tears down its volumes on every run precisely
so failures are real. Report the outcome plainly when checks pass, including
anything fixed along the way.

**4. A merge conflict means rebase onto `master`, without being asked.** If the
PR reports conflicts (`gh pr view --json mergeable,mergeStateStatus`):

```bash
git fetch origin master
git rebase origin/master
# resolve, then
git push --force-with-lease
```

Use `--force-with-lease`, never a bare `--force`. Resolve the conflicts on
their merits; if a resolution is a real judgement call about behaviour rather
than a mechanical overlap, stop and ask. After pushing, go back to rule 3 — the
checks must be re-watched on the rebased head, because that is a different
commit from the one they last ran against. Note the ruleset is deliberately not
"strict", so a branch does *not* need rebasing merely for being behind
`master`; do this on an actual conflict, not on every unrelated push.

**5. Merging is the user's call by default, and it has four steps.** With the
one standing exception in rule 6, never merge on your own initiative. When the
user does say to merge:

```bash
gh pr merge <n> --squash        # 1. merge (squash unless told otherwise)
git checkout master && git pull origin master   # 2. resync local master
git branch -d <branch>          # 3. delete the local branch
                                # 4. release the board claim (below)
```

Do all four — leaving a stale local `master` and a dead branch behind is the
part that quietly bites later, when the next branch is cut from an
out-of-date `master`. `-d` (not `-D`) is deliberate: it refuses if the branch
somehow isn't merged, which is a signal worth reading rather than overriding.
The remote branch is deleted by `gh pr merge` if the repo is set to do so;
check and delete it explicitly if it lingers.

**Step 4 is the board.** The merge is the moment the work ships, so it is the
moment the row becomes `done`: set its State, **strip the `WIP ` prefix from
its title**, and update the body to say what actually shipped. Until this step
the item is still claimed and still reads as claimed to every other agent —
which is correct while a PR is open, and wrong the second it lands.

**6. A proven bug fix merges itself.** There is one standing exception to rule
5, granted deliberately: a PR that fixes a bug *and proves that it did* does
not wait for the user. Merge it, then do all four steps of rule 5 exactly as if
the user had asked.

The point is not to save the user a click. It is that this shape of PR carries
its own evidence — the failing test **is** the argument — so there is nothing
left for a human to weigh, and asking anyway is latency in front of a foregone
answer.

**Every one of these must hold. Doubt about any of them means ask.**

- **It restores intended behaviour.** Something was meant to work and didn't.
  That is a different thing from a change to *what the product does* — new
  behaviour, changed copy, a different default, a judgement about what would be
  better. Those stay the user's, however small and however obviously right they
  look.
- **There is a regression test, and you watched it fail without the fix.** Not
  "a test exists", not "it would have failed" — you ran it against the unfixed
  code, saw it go red for the stated reason, and saw it go green on the fix. A
  regression test never observed to fail is not evidence of anything: it may be
  asserting something that was always true. If reverting the fix to prove this
  is impractical, that is a reason to ask, not a reason to skip the step.
- **Every required check is green on the PR's head commit** — `build-lint-test`,
  `go` and `e2e`, watched to a conclusion per rule 3, on the commit actually
  being merged rather than an earlier push.
- **The diff is the fix, its test and its evidence, and nothing else.**
  Drive-by refactors, unrelated tidying and opportunistic renames all take it
  out of scope. Deleting code the fix has just made dead stays in scope, and is
  worth doing.
- **Nothing in it is hard to walk back.** No migration that rewrites or deletes
  rows, no change to secrets, deploy config, CI workflows, the ruleset, or this
  file's own rules, and no dependency bump. A revert has to be the whole remedy.

Two things that do **not** clear the bar on their own. A green CI run: it says
only that nothing *else* broke, and a fix for an untested bug passes CI just as
happily as a fix for a tested one. And your own confidence in the diff. The
observed-failing test is the load-bearing part, and the one worth being strict
about.

**If the user asked to see it, show them.** An explicit "let me look before you
merge" outranks this rule, and so does a PR already handed over for review.
This is permission not to ask; it is not an instruction to hurry.

**Say what you merged and why it qualified** — the bug, the test that failed
and then passed, the checks. Not approval sought after the fact, but a report,
and the way anyone finds out if something merged that shouldn't have.

## Useful External Links

- [bigshop Notion board](https://app.notion.com/p/87fae8a2ed054f2c874201e827639bd8) —
  the ticketing system. See "Tracking work: the Notion board" above.
- [Netlify Dashboard](https://app.netlify.com/sites/big-shop/overview)
- [Fly.io Dashboard](https://fly.io/apps/big-shop-api) — the Go API. First-time setup,
  cutover and rollback: [fly-migration-runbook.md](./docs/fly-migration-runbook.md)
- [SendGrid](https://app.sendgrid.com) — all outbound email. The onboarding programme ships
  behind `ONBOARDING_EMAIL_ENABLED` (off); how to test it and switch it on:
  [email-testing-runbook.md](./docs/email-testing-runbook.md)
- [TiDB Console](https://tidbcloud.com/console/clusters/10445360365857932862/sqleditor?orgId=1372813089209222715&projectId=1372813089454538934) —
  the database. **Neither credential the system uses is root**, and they are
  split so each can be small: the API connects with four DML privileges on one
  schema and no DDL at all ([api-database-user.md](./docs/api-database-user.md)),
  and the deploy applies migrations as a separate account that does have DDL
  ([ci-database-user.md](./docs/ci-database-user.md)). Each doc has the grant,
  why it is exactly that, and how to rotate it. The local stack runs `api` under
  the same grant production does, so a change needing a fifth privilege fails on
  a pull request rather than as a 500.
- [Auth0 Management](https://manage.auth0.com/dashboard/eu/dev-x-n37k6b/applications/HxkTOH3ZYxjbsgrVI4ii1CV2TQx7hk9G/settings)
