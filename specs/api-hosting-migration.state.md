---
spec: specs/api-hosting-migration.md
status: in-progress
branch: fly-migration
pr:
---

Fly app name: `big-shop-api` (→ `big-shop-api.fly.dev`), chosen by the user at planning
time and baked into `fly.toml` and the `netlify.toml` rewrite.

This run covers **Phases 1–4 as code**. `flyctl` is not installed on this machine and no
Fly account is configured, so `fly launch`, secrets, `fly deploy` and the Phase 3
production verification are the user's to run, from `docs/fly-migration-runbook.md`
(written in Session 3). **Phase 5 is deliberately excluded** — the spec calls for it as a
separate PR after a cooling-off period.

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
Status: pending
Scope: `ci.yml` gains `push: branches: [master]` and a `go` job (gofmt gate, `go test`,
  both drift checks). `build.sh` reduces to `npm run package`; `GO_VERSION` leaves
  `netlify.toml`. New `.github/workflows/deploy-api.yml` gated on CI.
Depends on: Session 1
Commit:
Notes: Must land before Session 3 so the Go checks never run nowhere. The `required
  checks` ruleset matches on job name — the new `go` job is not a required check until the
  ruleset is updated; flagged, not fixed (repo settings, not code).

## Session 3: Phase 3 — dual run
Status: pending
Scope: `netlify.toml` rewrite `/api/bigshop/*` → `https://big-shop-api.fly.dev/api/bigshop/:splat`
  (`status = 200`, `force = true`), plus `docs/fly-migration-runbook.md` for the deploy and
  production-verification steps only the user can execute.
Depends on: Session 2
Commit:
Notes:

## Session 4: Phase 4 — cut over
Status: pending
Scope: New `lib/api-host.ts` (`serverApiHost()`, prefers `API_HOST_INTERNAL`, falls back to
  `NEXT_PUBLIC_API_HOST`); `lib/dave/tools.ts`, `lib/authenticate.ts` and
  `lib/recipe-import/known-names.ts` move onto it; `API_HOST_INTERNAL` set in
  `.env.development` and `scripts/dev-full.sh`; tests extended; env docs updated.
Depends on: Session 3
Commit:
Notes: Four `NEXT_PUBLIC_API_HOST` consumers confirmed by re-grep at planning time, three
  of them server-side — matches the spec's table.
