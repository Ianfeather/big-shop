---
spec: specs/api-hosting-migration.md
status: planned
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
Status: pending
Scope: Production `Dockerfile` + `.dockerignore`, `fly.toml`, raised HTTP timeouts on the
  `dev` server branch (it becomes the production server), router base path
  `/.netlify/functions/recipes` → `/api/bigshop`, regenerated `docs/openapi.yaml` and
  `types/api.d.ts`, and every local reference to the old path (`scripts/dev-full.sh`,
  `.env.development`, `e2e/env.ts`, `CLAUDE.md`, `technical-architecture.md`).
Depends on: none
Commit:
Notes: `e2e/env.ts` is filed under Phase 4 in the spec but has to move with the base path
  or e2e goes red immediately — same PR either way.

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
