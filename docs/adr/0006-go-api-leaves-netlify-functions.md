# The Go API leaves Netlify Functions for a long-lived container in Frankfurt

Status: accepted

The Go API stops being an AWS Lambda deployed through Netlify Functions and becomes a
long-lived container running on Fly.io in `fra` (Frankfurt), the same metro as the TiDB
cluster. Netlify keeps everything else — the Next.js site, SSR, the four LLM API routes,
branch deploys — and proxies `/api/*` to the Fly host with a `status = 200` rewrite, so
the API stays on `www.bigshop.life` and remains same-origin to the browser.

**Same metro is not the same datacenter, and deliberately so.** Fly.io runs its own
hardware rather than reselling AWS; TiDB Cloud Serverless is on AWS `eu-central-1`. So the
API-to-database hop crosses a provider boundary over Frankfurt peering rather than staying
on a provider's internal network — call it ~1–5ms with more jitter than an intra-AWS link,
against ~0.5–1ms had the API been placed in AWS `eu-central-1` itself. Across a
query-heavy request that difference is perhaps 10–25ms of the ~1,460ms this move turned out
to recover (see Measured outcome below; ~500ms was the estimate at decision time),
and buying it back would mean an AWS-native host: either materially more expensive
(App Runner, or Fargate behind an ALB) or handing back the OS, TLS and patching burden
that ruled out a VPS below. Accepted knowingly.

## Why

**Latency, mostly.** Netlify's functions region defaults to `cmh` (US East, Ohio) and
region selection is a Pro/Enterprise feature. TiDB is in `eu-central-1`. So every query
Big Shop makes is transatlantic, at roughly 90ms round trip, and the data-heavy paths —
shopping list generation especially — issue several sequentially. Moving the API into the
same metro as the database plausibly removes 300–500ms from those requests. Nothing else
on the table comes close to that. *(Left as written, because it is what was believed when
the decision was taken. The measured figure was about three times larger — see below.)*

**Netlify has deprecated Lambda compatibility mode**, and deploys containing functions in
that mode stop being accepted on 1 July 2027. `main.go` is squarely in that mode
(`lambda.Start` with `events.APIGatewayProxyRequest`), the documented migration path is an
npm package, and Netlify's public docs do not say what the path is for Go. Rather than
bet on that being resolved, this removes the dependency.

**No Netlify tier exposes Lambda layers or extensions** — this is a product boundary, not
a paywall, confirmed against the functions configuration docs. That rules out the standard
serverless observability pattern (a collector extension on `localhost:4318` flushing after
the response) at any price, and would have forced a synchronous flush on the critical path
of every request. A long-lived process makes the problem disappear rather than mitigating
it: the OTel SDK's batch processor exports in the background, off the request path. See
[ADR-0007](./0007-observability-otel-grafana-cloud.md).

## Why it is cheap to do

The API already runs as an ordinary HTTP server. `main.go`'s `dev` branch starts a plain
`http.Server` on `:8080` using the *same* negroni router the Lambda handler wraps, and
`netlify-functions/recipes/Dockerfile.dev` plus the `api` service in `docker-compose.yml`
already containerize it for local development and e2e. This is a production Dockerfile and
the deletion of a branch of `main()`, not a rewrite.

## Considered options

**Netlify Pro (~$19/mo) with `region = "fra"`** would fix the latency with no migration at
all, keeping branch deploys perfectly intact. Rejected because it costs roughly four times
a Fly machine while fixing strictly less: no tier gives a sidecar, the synchronous flush
would remain, and the 2027 Lambda-compat deadline would still be there.

**A Hetzner or Lightsail VPS (~£4/mo)** is cheaper still and gives complete control.
Rejected on ops burden — OS patching, TLS termination, restart policy and deploy tooling
all become ours, which is a poor trade against Fly's `fly deploy`-from-a-Dockerfile for a
few pounds a month.

**Staying on Netlify Functions** remains workable; the observability design that assumed
it was sound. Rejected because it means paying ~90ms per query indefinitely, and
instrumenting it would mostly serve to document that cost in detail.

## Measured outcome

Measured 2026-08-08, before cutover, against the same production Account and the same
production TiDB — `GET /shopping-list`, five samples each after a discarded warm-up, timed
as TTFB minus TLS-established so connection setup is excluded. Both paths go through
Netlify's edge: the Lambda on `www.bigshop.life`, Fly through the `/api/bigshop/*` rewrite
on a deploy preview, so this is the real production shape rather than a direct-to-origin
best case.

| | server | total |
| --- | --- | --- |
| Lambda, `us-east-2` | **1,624ms** | 1,678ms |
| Fly, `fra`, via the rewrite | **165ms** | 212ms |

**1,459ms removed — about 90% of the request, a 10x improvement.** Three to five times
the 300–500ms this decision was justified on.

**Why the estimate was low is now settled, and neither the count nor the hypothesis below
was right.** Follow-up #49 measured it (see `follow-ups-resolved.md` for the method and the
numbers). The short version: **`GET /shopping-list` costs fifteen blocking round trips, not
nine.** Nine is the number of *queries*, and a query is not a round trip. Six of the nine
carry parameters, and `database/sql` over `go-sql-driver` serves a parameterised query as a
server-side prepared statement — `COM_STMT_PREPARE`, wait, `COM_STMT_EXECUTE`, wait — so
each costs **two**. The three catalog queries take no parameters and go as a single
`COM_QUERY`. Six twos and three ones is fifteen, and fifteen at the ~90ms assumed above is
~1,350ms rather than ~810ms. The rest of the 1,624ms is the Netlify-edge-to-`us-east-2` hop
and one more transatlantic round trip nobody had counted at all: **every authenticated
request re-fetched the Auth0 JWKS**, uncached, before touching the database.

*This paragraph's original text is preserved below because being wrong in a specific,
recorded way is the useful part.* The leading hypothesis was connection establishment
rather than queries: TiDB Serverless requires TLS, so a new connection costs a TCP plus a
TLS handshake — three to four round trips — before any query runs, and `main.go` sets no
pool limits at all. That turned out to be real but not dominant: measured, a TLS MySQL
connection costs ~5 round trips (~450ms transatlantic), but it is paid **once per
connection**, and these samples were warm. It was the right suspicion about the wrong
term — the request was indeed paying for something other than queries, just not that.

The honest caveats: one endpoint, one Account, one moment. It is the endpoint this ADR
singled out as worst, so it is the right one to quote, but it is a headline rather than a
distribution — real percentiles arrive with the observability work.

The decision itself survives the correction intact, and for a better reason than it was
made on. Moving to the same metro as the database was justified on "several sequential
queries at ~90ms"; it turned out to be paying that ~90ms **fifteen** times per request
rather than nine, plus once more to Auth0. Every one of those is a transatlantic hop that
Frankfurt makes local, which is why the move recovered three times what was claimed for it.
The reason it over-delivered is that the round trips were undercounted, not that the
mechanism was wrong.

## Consequences

- **Branch deploys degrade.** A branch deploy of the frontend proxies to the same single
  API instance as production, rather than being a complete isolated stack. This is the one
  thing on the "what I like about Netlify" list that genuinely gets worse. Per-branch API
  deploys are possible on Fly but are not in scope.
- **Two deploy pipelines instead of one.** The Go tests currently run inside Netlify's
  build via `./build.sh`; they move to CI and the Fly deploy. `build.sh`, `netlify.toml`
  and the OpenAPI drift check all need revisiting.
- **Uptime for the API becomes ours**, including TLS at the Fly edge and restart
  behaviour. Previously Netlify's problem.
- `NEXT_PUBLIC_API_HOST` changes from `/.netlify/functions/recipes` to the proxied path.
- **Dave's server-side calls need thought.** `lib/dave/tools.ts` runs in a Netlify function
  in us-east-2 and makes several sequential calls to the Go API per turn. Routing those
  through the Netlify proxy would go us-east-2 → Netlify edge → Frankfurt; they should
  address the Fly host directly instead. Note this path does not get faster overall — it
  trades N transatlantic DB hops per tool call for one transatlantic API hop per tool
  call, which is an improvement but a smaller one than elsewhere.
- The origin can tell proxied traffic apart from direct traffic for free: Netlify attaches
  `x-nf-netlify-proxy`, a signed JWT (`iss: netlify`, `sub: proxy`), to every proxied
  request — no shared secret and no JWS configuration needed. This does not change the
  decision to leave the origin publicly reachable, because Dave's server-side calls
  address Fly directly and carry no such header, so unsigned traffic must be accepted
  regardless. Recorded because it is the obvious thing to reach for if that changes.
- Connection pooling to TiDB starts working properly. Every cold Lambda container
  previously built a fresh pool and `Ping`ed across the Atlantic during `init()` — since
  measured at ~5 round trips for a TLS MySQL connection, so ~450ms transatlantic, once per
  connection.
