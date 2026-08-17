# Move the Go API off Netlify Functions onto Fly.io in Frankfurt

Decisions and rationale: [ADR-0006](../../docs/adr/0006-go-api-leaves-netlify-functions.md).
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
- **Everything reaches the API through `NEXT_PUBLIC_API_HOST`.** Nothing constructs a
  Lambda URL of its own. There are four consumers, and **three of them run server-side**:
  `lib/api-client.ts` (browser), `lib/dave/tools.ts`, `lib/authenticate.ts` and
  `lib/recipe-import/known-names.ts`. See Phase 4 — that split is the migration's main
  correctness trap.

And three make it necessary:

- Netlify's functions region defaults to `cmh` (us-east-2) and region selection is
  Pro/Enterprise. TiDB is `eu-central-1`. Every query is transatlantic, several
  sequentially per request.
- Netlify's Lambda compatibility mode — which is what `lambda.Start` +
  `events.APIGatewayProxyRequest` is — stops being accepted for deploys on 1 July 2027.
- No Netlify tier exposes Lambda layers or extensions, so there is no collector sidecar
  and no post-response flush at any price.

Two pre-existing defects surface here and are fixed as part of the work:

- `app.go:211` sets `AllowedOrigins: {"*"}` with `AllowCredentials: true`. The CORS spec
  forbids that pairing, so it does not do what it appears to.
- `.github/workflows/ci.yml` triggers on `pull_request` and `workflow_dispatch` only.
  `go fmt`, `go test` and both drift checks live in `build.sh`, i.e. they run **only** in
  Netlify's deploy build. Remove Go from Netlify without addressing this and they stop
  running entirely.

## Proposed approach

### Phase 0 — DONE. The unknown is settled: `Authorization` is forwarded

**Answered empirically on 2026-08-05**, via a throwaway branch deploy (PR #74, since
closed) carrying the exact rewrite this migration proposes — `/api/bigshop/*`,
`status = 200`, `force = true` — pointed at an echoing origin. Netlify's docs do not
answer this, and the one support-forum thread asking it was closed without a staff reply,
so measurement was the only route.

| Question | Result |
| --- | --- |
| `Authorization` forwarded to an external origin? | **Yes**, intact |
| Arbitrary custom headers (`traceparent`, `X-Probe-Custom`)? | **Yes**, verbatim |
| `PUT` / `PATCH` / `DELETE` proxied? | **Yes**, all 200 |
| Method, body and `Content-Type` preserved on POST? | **Yes**, body round-tripped exactly |
| Genuine rewrite rather than a 302? | **Yes**, 0 redirects, URL unchanged |

**The `api.bigshop.life` subdomain fallback is therefore not needed**, and same-origin is
confirmed rather than assumed. Every route family the API actually uses — `apiGet` plus
`apiMutate`'s four verbs in `lib/api-client.ts` — is covered by the methods tested.

Netlify adds several headers on the way through, visible at the origin:

- `x-nf-client-connection-ip` — the real client IP survives the proxy, so rate limiting or
  abuse handling at the origin remains possible.
- `x-nf-request-id` — correlates a request with Netlify's own logs. Worth putting on spans;
  noted in [`observability.md`](./observability.md).
- `x-nf-netlify-proxy` — a **signed JWT** (`iss: netlify`, `sub: proxy`, carrying
  `request_id` and `client_ip`). This means the Fly origin could verify that traffic
  arrived via Netlify with no shared secret to manage — a cheaper mechanism than the JWS
  signing ADR-0006 considered and rejected. It does **not** change that decision: Dave's
  server-side calls address Fly directly and would not carry it, so the origin must accept
  unsigned traffic anyway. Recorded because it is the obvious thing to reach for later.
- `x-country`, `x-nf-account-tier`.
- Netlify **rewrites `Accept` to `*/*,image/webp`**. See "Things to get right" — Huma
  negotiates on `Accept`.

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
  variable (no `NEXT_PUBLIC_` prefix, and it must never acquire one).

**All three server-side consumers must switch to `API_HOST_INTERNAL`**, not just Dave.
A relative `NEXT_PUBLIC_API_HOST` is meaningless in a Node process, so any that is missed
breaks outright rather than merely running slowly:

| Consumer | Runs | Why it matters |
| --- | --- | --- |
| `lib/api-client.ts` | Browser | Stays on the relative path — this is the one that should |
| `lib/dave/tools.ts` | Netlify fn | Several calls per turn; avoids us-east-2 → edge → Frankfurt |
| `lib/authenticate.ts` | Netlify fn | **On the critical path of every authenticated Next.js route** — it authenticates by calling `GET /account` on the Go API |
| `lib/recipe-import/known-names.ts` | Netlify fn | Forwards the caller's header to read canonical Ingredient/Unit names |

`lib/authenticate.ts` deserves particular attention: it was added by #71 and means every
authenticated Next.js API route now makes a *synchronous* call to the Go API before doing
its own work. Post-migration that is a transatlantic hop from us-east-2 to Frankfurt on
every such request. Going direct rather than via the proxy removes one leg of it; removing
the other would mean moving those routes, which is out of scope.

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

- **Phase 0 is done** — see above. Nothing is blocked on it.
- **Netlify rewrites the `Accept` header to `*/*,image/webp` through the proxy.** Huma
  does content negotiation on `Accept`, so confirm during Phase 3's verification that
  responses still come back as JSON rather than something else. It should be fine — `*/*`
  is present and Huma resolves that to JSON — but it is a header the API's framework
  actually reads, mutated by an intermediary, which is exactly the shape of bug
  `follow-ups.md` #12 records being caught only by e2e.
- **Phase 2 before Phase 3.** There must be no window in which the Go checks run nowhere.
- `docs/openapi.yaml` and `types/api.d.ts` are generated and drift-checked. A base path
  change means regenerating both; the drift check will catch it if you forget, but only
  once the check is running in its new home.
- **A relative `NEXT_PUBLIC_API_HOST` (`/api/bigshop`) works in the browser and nowhere
  else.** Three server-side consumers must move to `API_HOST_INTERNAL` — see the table in
  Phase 4. This list was wrong in the first draft of this spec (it named two consumers;
  there are four) and grew again when #71 added `lib/authenticate.ts`, so re-grep for
  `NEXT_PUBLIC_API_HOST` at implementation time rather than trusting the table.
- The Netlify proxy has a **26 second ceiling**. Comfortable for CRUD; worth remembering
  if any endpoint ever grows slow.
- `docker-compose.yml`, `dev-full.sh` and the e2e stack already run the API as a plain
  server and need no structural change — only the base path in `e2e/env.ts`.
- Keep `/health`'s no-auth carve-out (`app.go:219`). It now backs a Fly health check as
  well as the uptime monitoring in `observability.md`.
