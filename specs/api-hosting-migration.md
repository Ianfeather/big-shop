# Move the Go API off Netlify Functions onto Fly.io in Frankfurt

Decisions and rationale: [ADR-0006](../docs/adr/0006-go-api-leaves-netlify-functions.md).
This spec covers the *how*. Do this before [`observability.md`](./observability.md) —
that spec's design assumes the API is a long-lived process.

## Current state (why this isn't greenfield)

The Go API is one AWS Lambda behind Netlify Functions. `main.go`'s `init()` builds a
negroni router via `app.GetRouter("/.netlify/functions/recipes")` and `main()` branches
three ways: `openapi` (print spec, exit), `dev` (plain `http.Server` on `:8080`), and
default (`lambda.Start`).

Three facts make this migration small:

- **The server already exists.** The `dev` branch runs the *same* router as an ordinary
  HTTP server. Production and local currently differ only in how the router is invoked.
- **It's already containerized.** `netlify-functions/recipes/Dockerfile.dev` plus the
  `api` service in `docker-compose.yml` build and run it, and the e2e suite depends on
  that working.
- **Nothing else in the repo talks to the Lambda directly.** `lib/api-client.ts` and
  `lib/dave/tools.ts` both go through `NEXT_PUBLIC_API_HOST`.

And three make it necessary:

- Netlify's functions region defaults to `cmh` (us-east-2) and region selection is
  Pro/Enterprise. TiDB is `eu-central-1`. Every query is transatlantic, several
  sequentially per request.
- Netlify's Lambda compatibility mode — which is what `lambda.Start` +
  `events.APIGatewayProxyRequest` is — stops being accepted for deploys on 1 July 2027.
- No Netlify tier exposes Lambda layers or extensions, so there is no collector sidecar
  and no post-response flush at any price.

Two pre-existing defects surface here and are fixed as part of the work:

- `app.go:170` sets `AllowedOrigins: {"*"}` with `AllowCredentials: true`. The CORS spec
  forbids that pairing, so it does not do what it appears to.
- `.github/workflows/ci.yml` triggers on `pull_request` and `workflow_dispatch` only.
  `go fmt`, `go test` and both drift checks live in `build.sh`, i.e. they run **only** in
  Netlify's deploy build. Remove Go from Netlify without addressing this and they stop
  running entirely.

## Proposed approach

### Phase 0 — Settle the one unknown, before anything else

**Does Netlify forward the `Authorization` header through a `status = 200` rewrite to an
external origin?** Netlify's docs do not say, and the entire API is bearer-authenticated.

Deploy any trivial echo service, add a rewrite, and `curl` it with a bearer token through
`www.bigshop.life`. This is an afternoon at most and it gates the whole design.

**If it fails**, the fallback is `api.bigshop.life` pointed straight at Fly — which costs
CORS preflights on mutations and requires fixing the wildcard-plus-credentials config
above, but is otherwise equivalent and is arguably *faster* for UK users. Do not proceed
past Phase 1 without an answer.

### Phase 1 — Make it deployable

- Production `Dockerfile` (multi-stage, static build, no `air`, non-root) alongside the
  existing `Dockerfile.dev`.
- `fly.toml`: one `shared-cpu-1x` machine, **512MB** (Go plus the collector sidecar that
  `observability.md` adds later), region `fra`, `auto_stop_machines = false`.
- `DSN` as a Fly secret. `main.go:37`'s TiDB TLS config is unchanged — it pins
  `gateway01.eu-central-1` and Fly reaches it identically, over the public endpoint.
  Note Fly runs its own hardware, so `fra` is the same *metro* as TiDB's AWS
  `eu-central-1`, not the same provider network — the hop is Frankfurt peering at
  ~1–5ms rather than intra-AWS at ~0.5–1ms. Accepted in ADR-0006; no private
  networking or PrivateLink is available or attempted.
- Change the router base path from `/.netlify/functions/recipes` to **`/api/bigshop`**,
  then regenerate both derived artefacts:
  `go run . openapi > ../../docs/openapi.yaml` and `npm run generate:api-types`.
- Fly health check on `/health`.

### Phase 2 — Move the checks before removing them

- Add a `go` job to `ci.yml`: `go fmt ./...`, `go test ./... -v`, the `openapi.yaml` drift
  check, and the existing `api.d.ts` drift check.
- **Add `push: branches: [master]` to `ci.yml`'s triggers.** Without this, the checks
  currently guaranteed by Netlify's deploy build would only run on PRs.
- `build.sh` reduces to `npm run package`. Remove `GO_VERSION` from `netlify.toml`.
- New `deploy-api.yml`: on push to master, gated on CI, builds the image and runs
  `fly deploy`.

Phase 2 lands *before* Phase 3 so there is never a window where the Go checks run nowhere.

### Phase 3 — Dual run

Deploy to Fly and add the rewrite while the frontend still points at the Lambda:

```toml
[[redirects]]
  from = "/api/bigshop/*"
  to = "https://<app>.fly.dev/api/bigshop/:splat"
  status = 200
  force = true
```

Nothing is live — no client requests that path yet. Both APIs serve the same production
TiDB, so there is no data migration and no divergence.

Verify against real production data: an authenticated `GET /api/bigshop/recipes` through
`www.bigshop.life`, a write, and `/health`. Compare a shopping-list generate's latency
against the Lambda's for the same account.

### Phase 4 — Cut over

One frontend deploy changes two values:

- `NEXT_PUBLIC_API_HOST` → `/api/bigshop` (relative — same origin via the rewrite)
- `API_HOST_INTERNAL` → `https://<app>.fly.dev/api/bigshop`, a new **server-side-only**
  variable for `lib/dave/tools.ts`, so Dave's several-per-turn tool calls go straight to
  Frankfurt instead of us-east-2 → Netlify edge → Frankfurt.

`e2e/env.ts`'s `API_HOST` changes to the new base path in the same PR.

Rollback is reverting those values and redeploying. The Lambda is still there, still
serving its old path, untouched.

### Phase 5 — Tidy up, after a cooling-off period

Deliberately a separate PR, days later:

- Delete the `lambda.Start` branch from `main()`, plus `aws-lambda-go` and
  `aws-lambda-go-api-proxy` from `go.mod`. The `dev` branch becomes the only server path,
  so production and local run identical code.
- Rename `netlify-functions/recipes/` → `api/`. Update `docker-compose.yml`, `build.sh`,
  `scripts/build-local.sh`, `CLAUDE.md`, `technical-architecture.md`.
- Fix the CORS config to a real origin allowlist.

## Decisions made (grilled — do not re-litigate without a load-bearing reason)

- **Fly.io, `fra`, one always-on machine.** Not Netlify Pro (costs ~4× and fixes less —
  no sidecar at any tier, flush remains, deadline remains). Not a Hetzner/EC2 VPS (cheaper
  but OS, TLS, patching and deploy tooling all become ours). Not auto-stop — cold starts
  are what we are migrating away from.
- **Netlify keeps everything else**: the Next.js site, SSR, the four LLM API routes,
  branch deploys.
- **Same origin via a 200 rewrite**, not a subdomain — preserves the no-CORS property.
  Subdomain is the documented fallback if Phase 0 fails.
- **Base path `/api/bigshop`.** `/api/*` alone would swallow the five Next.js routes.
  No version segment; `/api/bigshop/v1` remains available later at the cost of one
  regeneration.
- **The Fly origin stays publicly reachable**, guarded by the Auth0 JWT validation that
  already guards every route bar `/health`. No JWS signing — it is defence in depth over
  an already-authenticated API, and buying it would mean either slowing Dave down or
  maintaining a second auth path.
- **Dual-run cutover**, flipped by env var, with the Lambda left deployed for a
  cooling-off period. Not big-bang.
- **Go checks move to `ci.yml` wholesale**, with a push trigger added.

## Explicitly out of scope

- Per-branch API deploys. Branch deploys will proxy to the single production API instance.
  This is a real, accepted degradation — see ADR-0006's consequences.
- Moving the Next.js LLM routes anywhere. They stay Netlify Functions in us-east-2; their
  latency is dominated by OpenAI calls measured in seconds.
- Multi-instance or multi-region Fly deployment. One machine; revisit if deploy blips
  become annoying.
- Any observability work. That is [`observability.md`](./observability.md), and it depends
  on this landing first.

## Things to get right when building this

- **Phase 0 gates everything.** Do not build a Dockerfile before knowing whether the
  proxy forwards `Authorization`.
- **Phase 2 before Phase 3.** There must be no window in which the Go checks run nowhere.
- `docs/openapi.yaml` and `types/api.d.ts` are generated and drift-checked. A base path
  change means regenerating both; the drift check will catch it if you forget, but only
  once the check is running in its new home.
- `lib/dave/tools.ts` currently reads `NEXT_PUBLIC_API_HOST` for server-side calls. It
  must switch to `API_HOST_INTERNAL`, which has no `NEXT_PUBLIC_` prefix and must not
  acquire one — it should never reach the browser bundle.
- A **relative** `NEXT_PUBLIC_API_HOST` (`/api/bigshop`) works for the browser but not for
  anything server-side, which is precisely why Dave needs its own absolute variable. Check
  every consumer of `NEXT_PUBLIC_API_HOST` for server-side use before assuming a relative
  value is safe.
- The Netlify proxy has a **26 second ceiling**. Comfortable for CRUD; worth remembering
  if any endpoint ever grows slow.
- `docker-compose.yml`, `dev-full.sh` and the e2e stack already run the API as a plain
  server and need no structural change — only the base path in `e2e/env.ts`.
- Keep `/health`'s no-auth carve-out (`app.go:179`). It now backs a Fly health check as
  well as the uptime monitoring in `observability.md`.
