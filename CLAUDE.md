# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Big Shop is a recipe management and meal planning app: a Next.js 16 / React 19 frontend with Auth0 auth, a Go API backend deployed as AWS Lambda via Netlify Functions, and a TiDB (MySQL-compatible) database.

- **What this product is** (Account, Recipe, Shopping List, and the rest of the domain vocabulary) → [CONTEXT.md](./CONTEXT.md)
- **How it's built** (DB schema, API routes, component structure, hooks, deployment, dependencies) → [technical-architecture.md](./technical-architecture.md)
- **Known issues we don't plan to fix** (investigated, judged not worth acting on — check here before chasing a surprising error) → [known-issues.md](./known-issues.md)

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

### Local Development Setup

**Fastest path — full local stack:** `npm run dev:full` (needs Docker running).
This runs `scripts/dev-full.sh`, which:
- Brings up `docker-compose.yml`'s `db` (MySQL 8, seeded once on first run from
  `migrations/*.sql` + `docker/mysql-seed/dev-seed.sql` via
  `docker/mysql-init/01-migrate-and-seed.sh`) and `api` (the Go binary's
  `serve` mode — the same one the production container on Fly runs —
  `DISABLE_AUTH=true`, hot-reloaded with `air` — edit any `.go` file and
  it rebuilds automatically) services.
- Brings up `lgtm` (`grafana/otel-lgtm` — Collector, Tempo, Loki, Prometheus
  and Grafana in one image), the local stand-in for the Grafana Cloud stack.
  Grafana is on **3200**, not 3000 — the web app keeps 3000. The API exports
  to it over the compose network at `lgtm:4318` and is never blocked on it
  being up. Opt out with `START_LGTM=false`, which is what the e2e suite does
  (see below). See [ADR-0007](./docs/adr/0007-observability-otel-grafana-cloud.md).
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
`.env.development`). It needs a live DB via `DSN`, and `DISABLE_AUTH=true`
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
Requires Docker: `webServer` in the config auto-starts `npm run dev:full`
against pinned ports with its own `COMPOSE_PROJECT_NAME=bigshop-e2e`, so it
won't collide with another worktree's stack; `test:e2e`/`test:e2e:debug` both
run `test:e2e:stop` first to tear down any containers left over from an
interrupted previous run (otherwise `dev-full.sh`'s own auto-increment-on-
collision port logic silently drifts to different ports than the ones pinned
in `e2e/env.ts`).

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
artifacts.

**Both CI workflows are required checks and block merging into `master`.** The
`required checks` repository ruleset requires the `build-lint-test` job (from
`ci.yml`) and the `e2e` job (from `e2e.yml`) to pass on every pull request.
Renaming either job in its workflow file silently breaks the gate — the
ruleset matches on job name, and a check that never reports is not the same
as a check that fails. Update the ruleset in the same change.

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

Both `build-lint-test` and `e2e` are required and both must be green. A red
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

**5. Merging is the user's call, and it has three steps.** Never merge on your
own initiative. When the user does say to merge:

```bash
gh pr merge <n> --squash        # 1. merge (squash unless told otherwise)
git checkout master && git pull origin master   # 2. resync local master
git branch -d <branch>          # 3. delete the local branch
```

Do all three — leaving a stale local `master` and a dead branch behind is the
part that quietly bites later, when the next branch is cut from an
out-of-date `master`. `-d` (not `-D`) is deliberate: it refuses if the branch
somehow isn't merged, which is a signal worth reading rather than overriding.
The remote branch is deleted by `gh pr merge` if the repo is set to do so;
check and delete it explicitly if it lingers.

## Useful External Links

- [Netlify Dashboard](https://app.netlify.com/sites/big-shop/overview)
- [Fly.io Dashboard](https://fly.io/apps/big-shop-api) — the Go API. First-time setup,
  cutover and rollback: [fly-migration-runbook.md](./docs/fly-migration-runbook.md)
- [TiDB Console](https://tidbcloud.com/console/clusters/10445360365857932862/sqleditor?orgId=1372813089209222715&projectId=1372813089454538934)
- [Auth0 Management](https://manage.auth0.com/dashboard/eu/dev-x-n37k6b/applications/HxkTOH3ZYxjbsgrVI4ii1CV2TQx7hk9G/settings)
- [Trello Backlog](https://trello.com/b/LnaGkQyG/bigshop)
