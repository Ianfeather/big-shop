---
spec: specs/api-hosting-migration.md
status: in-progress
branch: fly-migration
pr: https://github.com/Ianfeather/big-shop/pull/76
---

**The code for Phases 1–4 is written and green; the migration is not done.** This file and
the spec briefly moved into `specs/completed/` when the PR opened, which was wrong — the
cutover had not happened and Phase 5 had not started. Moved back on 2026-08-08.

## Where this actually is

| | State |
| --- | --- |
| PR [#76](https://github.com/Ianfeather/big-shop/pull/76) | Open, all checks green, **not merged** |
| Fly app `big-shop-api` | **Live**, verified 2026-08-08 — `/api/bigshop/health` 200, `/api/bigshop/recipes` 401 |
| `FLY_API_TOKEN` repo secret | Not set — `deploy-api.yml` fails at its last step until it is |
| `go` in the `required checks` ruleset | Not added |
| Cutover (runbook step 5) | Not done. **Merging the PR is the cutover** — `.env.production` carries the post-cutover values |
| Phase 5 | Not started, by design |

## Still to do

1. `fly tokens create deploy` → add as repo secret `FLY_API_TOKEN`.
2. Add `go` to the `required checks` ruleset (it matches on job name; until then the job
   gates nothing, and a red `go` silently stops the API deploying while Netlify keeps
   shipping the site).
3. Runbook step 5: check Netlify's own env vars are not still overriding
   `NEXT_PUBLIC_API_HOST` with the Lambda URL, verify the proxy, compare a shopping-list
   generate's latency against the Lambda, then merge.
4. **Phase 5, days later, as a separate PR**: delete the `lambda.Start` branch and
   `lambdaBasePath` from `main.go`, drop `aws-lambda-go`/`aws-lambda-go-api-proxy`, remove
   `GO_VERSION` from `netlify.toml`, rename `netlify-functions/recipes/` → `api/`, fix the
   CORS allowlist. **Merging it is what makes rollback stop working**, so not the same day.

Known ergonomics wrinkle found on first contact with the deployed app: a bare `/health`
returns 401, because the carve-out is `basePath + "/health"` and everything is registered
under `/api/bigshop`. `fly.toml`'s check uses the right path, so this is cosmetic — but it
is the first thing anyone tries, and `observability.md`'s uptime monitor will meet it too.
A root alias in `app.go`'s carve-out would cost two lines and no OpenAPI regeneration.

Fly app name: `big-shop-api` (→ `big-shop-api.fly.dev`), chosen by the user at planning
time and baked into `fly.toml` and the `netlify.toml` rewrite.

This run covers **Phases 1–4 as code**. `flyctl` is not installed on this machine and no
Fly account is configured, so `fly launch`, secrets, `fly deploy` and the Phase 3
production verification are the user's to run, from `docs/fly-migration-runbook.md`
(written in Session 3). **Phase 5 is deliberately excluded** — the spec calls for it as a
separate PR after a cooling-off period.

## Branch-deploy verification (post-PR)

All CI green on the first run, including the new `go` job (46s) and Netlify's own
**Redirect rules** check, which validates the `[[redirects]]` block. Netlify's build also
succeeded, independently confirming that keeping `GO_VERSION` was right — it still compiled
the Lambda.

Against `deploy-preview-76--big-shop.netlify.app`, which is the only place the two things
that cannot be tested locally could be checked:

```
GET /.netlify/functions/recipes/health   -> 200 "ok"   # lambdaBasePath works; rollback target is real
GET /.netlify/functions/recipes/recipes  -> 401        # ...with auth still running
GET /api/bigshop/health                  -> 502        # rewrite fires; no Fly app exists yet
```

The 502 is the correct result at this stage: it proves the rewrite is wired and aimed at
`big-shop-api.fly.dev`, which runbook step 1 creates.

## Session 1: Phase 1 — make it deployable
Status: done
Scope: Production `Dockerfile` + `.dockerignore`, `fly.toml`, raised HTTP timeouts on the
  `dev` server branch (it becomes the production server), router base path
  `/.netlify/functions/recipes` → `/api/bigshop`, regenerated `docs/openapi.yaml` and
  `types/api.d.ts`, and every local reference to the old path (`scripts/dev-full.sh`,
  `.env.development`, `e2e/env.ts`, `CLAUDE.md`, `technical-architecture.md`).
Depends on: none
Commit: f925c12
Notes: Gates green — vitest 134, e2e 21, `go test`/`go vet`/`gofmt` clean, both drift
  checks clean, and the production image verified serving real reads *and* writes against
  a local MySQL (including with `Accept: */*,image/webp`, which still returns
  `application/json` — the spec's Huma-negotiation worry, cleared at the origin).

  Deviations from the spec's Phase 1, all deliberate:
  - `e2e/env.ts` is filed under Phase 4 in the spec but has to move with the base path or
    e2e goes red immediately — same PR either way.
  - The `dev` server branch is renamed `serve` (`dev` still accepted as an alias, so
    CLAUDE.md's documented invocation keeps working). It is the production server now, so
    a container started by an argument called "dev" read as a mistake.
  - Its timeouts go from 3s read/write to 10s/30s/120s and `ListenAndServe` now
    `log.Fatal`s. Those timeouts had never applied to production traffic — the Lambda path
    ignores them — and 3s would have truncated shopping-list generation.

  Two review findings fixed, both raised independently by the Standards and Spec agents:
  - **`lambdaBasePath` added.** A single `basePath` const would have made the redeployed
    Lambda 404 on its own path, silently voiding the spec's rollback story ("The Lambda is
    still there, still serving its old path, untouched"). The Lambda now keeps its old
    prefix; the server uses the new one; Phase 5 deletes the former with `lambda.Start`.
  - **`AUTH0_DOMAIN`/`AUTH0_AUDIENCE` pinned in `fly.toml`'s `[env]`.** The spec names only
    `DSN`. With `AUTH0_DOMAIN` unset the JWKS fetch resolves to `https:///...` and every
    authenticated route rejects while `/health` stays green — a machine that looks
    deployed and serves nothing. `SENDGRID_API_KEY` is the other var the API reads; it is
    a secret, so it goes in the runbook alongside `DSN`.

  Not verified locally: Lambda-mode route registration (it needs a Lambda runtime). The
  Netlify branch deploy this PR triggers is the real check — the old path must still work
  there.

## Session 2: Phase 2 — move the checks before removing them
Status: done
Scope: `ci.yml` gains `push: branches: [master]` and a `go` job (gofmt gate, `go test`,
  both drift checks). `build.sh` reduces to `npm run package`; `GO_VERSION` leaves
  `netlify.toml`. New `.github/workflows/deploy-api.yml` gated on CI.
Depends on: Session 1
Commit: a1fa73d
Notes: Gates green — vitest 134, typecheck, lint, all three workflow YAMLs and both TOMLs
  parse, all shell scripts pass `bash -n`.

  Deviations from the spec's Phase 2:
  - **`GO_VERSION` stays in `netlify.toml`**, contrary to "Remove `GO_VERSION` from
    `netlify.toml`". Netlify still *compiles* the Lambda on every deploy through the
    cooling-off period — the functions directory is configured in the Netlify UI, not in
    `netlify.toml`, which is exactly why removing the pin looks safe from the repo alone.
    A failed Netlify build takes the whole site down, not just the API. Phase 5 deletes
    the function and the pin together.
  - **`gofmt -l`, not `go fmt ./...`** as the spec words it. `go fmt` rewrites files and
    exits 0 regardless, so the check as specified would have shipped as a gate that can
    never fail — it has been one in `build.sh` all along.
  - **`go vet` added** (spec lists four checks, not five) and `scripts/build-local.sh`
    updated to match, so the local script and CI don't drift.

  Review findings fixed: stale docs in `CLAUDE.md` and `technical-architecture.md` (three
  statements about `build.sh` running Go tests, now false); `deploy-api.yml`'s concurrency
  comment contradicted its config; manual dispatch would have deployed whatever branch it
  was dispatched from; `setup-flyctl@master` pinned to `@v1.4` (it is the only job holding
  `FLY_API_TOKEN`); `npm ci` added before the `api.d.ts` drift check so the pinned
  generator runs rather than whatever `npx` fetches.

  **ACTION REQUIRED (repo setting, not code): add `go` to the `required checks` ruleset.**
  Worse than a missing gate — `deploy-api.yml` keys off the whole CI workflow's
  conclusion, so a red `go` job merged through the un-updated ruleset silently stops the
  API deploying while Netlify goes on shipping the site from that same commit.

  Known limitation, accepted and tracked as `follow-ups.md` #43: the deploy is gated on CI
  only, as the spec says, and `e2e.yml` is a separate workflow a `workflow_run` cannot see.
  Narrower than it sounds — every commit on `master` came through a PR where both suites
  were green — but the ruleset is not "strict", so the merge commit itself is CI-verified
  and not e2e-verified, and it is the merge commit that deploys.

  `push: branches: [master]` on `ci.yml` turns out to matter for a different reason than
  first written. It is not extra check coverage: a direct push to `master` is *rejected*,
  not merely ungated (master's own `d81c9d6` established this after the branch was cut).
  It is required because `deploy-api.yml`'s `workflow_run` filters on the triggering run's
  head branch, which for a `pull_request` run is the PR's branch and never `master` —
  without the push trigger the API would never deploy at all. Comment corrected on rebase.

## Session 3: Phase 3 — dual run
Status: done
Scope: `netlify.toml` rewrite `/api/bigshop/*` → `https://big-shop-api.fly.dev/api/bigshop/:splat`
  (`status = 200`, `force = true`), plus `docs/fly-migration-runbook.md` for the deploy and
  production-verification steps only the user can execute.
Depends on: Session 2
Commit: 19ca47a
Notes: Gates green — vitest 134, e2e 21, typecheck, lint, `netlify.toml` parses and the
  redirect resolves as intended. Confirmed no `pages/api` route is shadowed: the five are
  `parse-recipe-text`, `parse-recipe-url`, `recipe-image`, `dave/chat`, `dev/openapi-spec`,
  all siblings of `/api/bigshop` rather than under it.

  The rewrite cannot be verified locally — e2e talks to the container directly, and there
  is no Netlify proxy in front of `next dev`. Its real verification is the runbook's step 5.

  Review caught four runbook commands that would not have worked as written:
  - `fly tokens deploy` is not a command (`fly tokens create deploy` is).
  - Every `fly` command must run from `netlify-functions/recipes`. `--config` relocates
    only the config *file*; the app root and Docker build context still come from the
    working directory, so running from the repo root would have used the whole repo as
    build context with no Dockerfile in it.
  - The rewrite-vs-redirect check used `curl -I`. The `/health` carve-out in `app.go` is
    `r.Method == http.MethodGet`, so a HEAD falls through to the JWT middleware and returns
    401 on a *healthy* deploy — the check would have failed precisely when all was well.
  - `/health` returns the bare string `ok`, not JSON.

  Also swapped `fly launch` for `fly apps create`: `fly.toml` and `Dockerfile` are already
  committed, so there is nothing to scaffold, and launch's framework detection would have
  found the Next.js app at the repo root.

## Session 4: Phase 4 — cut over
Status: done
Scope: New `lib/api-host.ts` (`serverApiHost()`, prefers `API_HOST_INTERNAL`, falls back to
  `NEXT_PUBLIC_API_HOST`); `lib/dave/tools.ts`, `lib/authenticate.ts` and
  `lib/recipe-import/known-names.ts` move onto it; `API_HOST_INTERNAL` set in
  `.env.development` and `scripts/dev-full.sh`; tests extended; env docs updated.
Depends on: Session 3
Commit: fa21ebd
Notes: Gates green — vitest 143 (31 files), e2e 21, typecheck, lint.

  Consumer set re-grepped at implementation time as the spec insists: four, three of them
  server-side, matching the table. `lib/api-client.ts` correctly stays on
  `NEXT_PUBLIC_API_HOST`. Nothing outside `.ts` constructs a Go API URL.

  Two additions beyond the spec's letter, both from review:
  - **`serverApiHost()` rejects a relative value** instead of returning it. A relative path
    is truthy, so the exact misconfiguration the spec warns about (`API_HOST_INTERNAL`
    forgotten, `NEXT_PUBLIC_API_HOST` relative) sailed past every caller's `if (!host)`
    guard and surfaced as an opaque `fetch` throw. Now it logs the missing variable and
    takes the existing not-configured path.
  - **`.env.production` updated** — it is tracked, and both reviewers caught that leaving
    it naming the Lambda created a silent fallback: forget the Netlify variable and auth,
    import and Dave quietly keep using a Lambda that Phase 5 deletes. It now carries the
    post-cutover values, which makes **merging the PR the cutover**. Netlify's own env vars
    still override the file, so they remain the rollback lever. Runbook step 5 reordered
    accordingly: Fly must be verified *before* merge.

  Test quality was the real finding. Under mutation (`serverApiHost()` →
  `process.env.NEXT_PUBLIC_API_HOST`) the suite now fails in 5 places across three files.
  Before this session `known-names.test.ts` passed that mutation — it asserted a URL
  *suffix*, which a relative path satisfies — and `lib/dave/tools.ts` had no coverage of
  the non-mock path at all (all 12 existing cases pass `useMockApi = true`).
  `pages/api/recipe-image.test.mts` had its stub corrected to the production shape, but it
  stubs `fetch` without inspecting the URL, so it does not catch the regression;
  `authenticate.test.ts` is what does.

  Also extracted `toolApiHost()` from four identical lines in `tools.ts`.
