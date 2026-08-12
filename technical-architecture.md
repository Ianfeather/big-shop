# Technical Architecture

For product/domain vocabulary (Account, Recipe, Shopping List, etc.), see [CONTEXT.md](./CONTEXT.md).

## Architecture Overview

Big Shop is a recipe management and meal planning application with a hybrid Next.js frontend and Go API backend:

- **Frontend**: Next.js 16 / React 19 with Auth0 authentication
- **Backend**: Go API deployed as AWS Lambda via Netlify Functions
- **Database**: TiDB (MySQL-compatible) for production, local MySQL for development
- **Deployment**: Netlify with automatic deployments from git
- **AI**: OpenAI GPT-4 Vision (recipe image extraction) + GPT-3.5-turbo (Dave chat assistant)

### Key Components

- `pages/`: Next.js pages with file-based routing
- `components/`: Reusable React components organized by feature
- `hooks/`: Custom React hooks for shared logic
- `netlify-functions/recipes/`: Go API with JWT authentication
- `migrations/`: SQL database schema migrations
- `mocks/`: JSON files for local development without API
- `pages/api/`: Next.js serverless API routes (image recognition, Dave chat, recipe import)

### Authentication Flow

The app uses Auth0 for authentication:
- Public route: `/` (landing page)
- All other routes require authentication
- JWT tokens are fetched per call site: each `hooks/use-*.ts` query and mutation calls
  `getAccessTokenSilently()` itself. There is no shared request interceptor (`use-http`
  and its `FetchProvider` were removed — see `pages/_app.tsx`)
- For local development, set `DISABLE_AUTH=true` in `.env.local`

## Go API Structure

Located in `netlify-functions/recipes/`:
- `main.go`: entry point, TiDB connection, Negroni router setup. `main()` branches three
  ways on `os.Args[1]`: `openapi` prints the spec and exits, `serve` (or its older alias
  `dev`) runs a plain `http.Server` on `:8080` — which is what both local development
  *and* the production container on Fly run — and the default is `lambda.Start`, still
  deployed to Netlify Functions during the migration's cooling-off period
  ([spec](./specs/api-hosting-migration.md) Phase 5 deletes it)
- `basePath` / `lambdaBasePath` (`main.go`): the server registers routes under
  `/api/bigshop`, which is also the OpenAPI server URL — Netlify rewrites that path to
  the Fly origin with `status = 200`, so the API stays same-origin to the browser. The
  Lambda goes on registering under `/.netlify/functions/recipes`, because Netlify routes
  to a function by the function's own path; that is what keeps it a working rollback
  target during the cooling-off period
- `Dockerfile`: production image (static binary on distroless, non-root) — distinct from
  `Dockerfile.dev`, the toolchain-plus-`air` image `docker-compose.yml` builds
- `fly.toml`: always-on `shared-cpu-1x`/512MB machines in `fra`. Two containers per
  Machine, defined in `machine_config.json`: the API and an OpenTelemetry Collector
  sidecar. **A container receives only the secrets its `secrets` array names** —
  `fly secrets set` alone is not enough, and a missing declaration fails silently
- `machine_config.json` / `otel-collector.yaml`: the sidecar definition and the
  collector's config, delivered as a real file via per-container `files`
- `internal/pkg/app/app.go`: App struct, JWT middleware, all route definitions (`GetRouter`, ~line 145)
- `internal/pkg/app/*.go`: Feature handlers
- `internal/pkg/telemetry/`: OpenTelemetry setup (`telemetry.go`) and the HTTP
  instrumentation (`http.go`)

### Observability

Traces, metrics and logs go out over OTLP/HTTP to whatever
`OTEL_EXPORTER_OTLP_ENDPOINT` names — `grafana/otel-lgtm` locally, an OTel
Collector sidecar on Fly in production. **An unset endpoint disables the SDK
entirely**, which is what `go test`, the Lambda path and the e2e stack get.
Decisions: [ADR-0007](./docs/adr/0007-observability-otel-grafana-cloud.md);
what telemetry deliberately omits: [ADR-0008](./docs/adr/0008-what-telemetry-does-not-carry.md).

Three things about the wiring are easy to break by tidying:

- **`telemetry.Setup` runs before the DB is opened** in `main.go`'s `init()`.
  `otelsql` captures the tracer provider at `Open`, so setting up afterwards
  leaves every query span going to the no-op provider — instrumentation that
  looks present and emits nothing.
- **`otelsql` only spans a query whose context already carries one**
  (`SpanFilter` in `main.go`). Most of the service layer still calls
  `db.Query` rather than `QueryContext`, and those would otherwise become
  *root* spans — rootless single-span traces by the thousand. A route lights
  up when its context is threaded through, and stays silent until then.
- **`DisableErrSkip`** is set because `driver.ErrSkip` is not a failure: it is
  how `database/sql` and the driver negotiate the fast path. Left recorded,
  every query span carries `STATUS_CODE_ERROR`.

Instrumentation currently covers `GET /recipes` only — an allow-list in
`telemetry/http.go` (`phase1Routes`) — which the observability spec widens to
every route next.

**Route list**: routes are registered in `internal/pkg/app/app.go`'s `GetRouter`, using [Huma](https://github.com/danielgtaylor/huma) (`humamux`, on top of the same `gorilla/mux` router) so each operation's request/response types double as its OpenAPI schema - no separate hand-maintained doc to drift. The generated spec is committed at [`docs/openapi.yaml`](./docs/openapi.yaml); regenerate it with `cd netlify-functions/recipes && go run . openapi > ../../docs/openapi.yaml` (no DB needed - route registration never touches it). `.github/workflows/ci.yml`'s `go` job fails if the committed spec is stale relative to `app.go` (it used to be `build.sh`, i.e. only during a Netlify deploy). All routes except `/health` require Auth0 JWT validation; the user ID is extracted from the JWT `sub` claim and threaded through context to handlers.

### API Testing
For authenticated endpoints, copy the `Authorization` header from browser dev tools — no established curl/Postman workflow exists yet.

## Next.js API Routes (pages/api/)

| Route | File | Purpose |
|-------|------|---------|
| `/api/recipe-image` | `recipe-image.mjs` | GPT-4 Vision: photo → structured recipe JSON (async, polled). A `mode=method` form field switches it to Method Import — same upload, auth, job and polling, but only the method is read out of the photo, and the canonical Ingredient/Unit lookup is skipped |
| `/api/parse-recipe-url` | `parse-recipe-url.js` | Fetches a recipe URL, reduces the page to the recipe (`lib/recipe-import/url.js`: schema.org JSON-LD where present, else the page's visible text) and makes one LLM call to extract name/ingredients/method/vegetarian-ness — works against any recipe site, replacing the older per-site DOM-selector-plus-regex scrapers (formerly `pages/api/third-parties/*`, now deleted). 422s rather than returning a recipe with no ingredients |
| `/api/parse-recipe-text` | `parse-recipe-text.js` | LLM-parses freeform multiline ingredient text (Manual Entry's bulk paste box) into structured ingredient lines |
| `/api/parse-method-url` | `parse-method-url.ts` | Method Import from a link: same page reduction as `/api/parse-recipe-url`, but one LLM call for the method alone (`extractMethod`), no canonical-name lookup, and it accepts a page with no ingredient list. 422s rather than returning an empty method. Unlike the routes above it requires a valid token |
| `/api/dave/chat` | `dave/chat.js` | GPT-3.5-turbo chat with tool calling (search/get/create shopping list) |

The recipe image extraction uses Netlify Blobs to store async job results; the frontend polls every 2 seconds until complete.

## Database Schema

Production: TiDB (MySQL-compatible). Migrations in `migrations/` applied manually, in order — there is no consolidated schema file, so `migrations/*.sql` (currently 32 files) is the authoritative source for exact columns/constraints.

| Table | Purpose |
|-------|---------|
| `recipe` | Recipe records (id, name, slug, remote_url, account_id) |
| `ingredient` | Canonical ingredient names, plus `base_unit_id` (what its Amounts are added up in), `display_unit_id` (what a Shopping List shows them as) and `pantry_staple` (grouped away on the Shopping List by default — see CONTEXT.md's Pantry Staple) |
| `ingredient_unit_size` | How much one `<unit>` of an `<ingredient>` is, in that ingredient's base unit — average weight, pack size and density are all this one relation (see [ADR-0004](./docs/adr/0004-unit-size-as-one-relation.md)) |
| `unit` | Measurement units (gram, litre, teaspoon, packet, etc.), each with a `kind` (weight/volume/relative), a `factor` for Absolute Units, and an optional `default_size` |
| `part` | Recipe ↔ ingredient join (recipe_id, ingredient_id, unit_id, quantity) |
| `tag` | Recipe tags (Vegetarian, Batch Cook, etc.) |
| `recipe_tag` | Recipe ↔ tag join |
| `department` | Ingredient categories (vegetables, meat and fish, other) |
| `ingredient_department` | Ingredient ↔ department join |
| `list` | Shopping list items (account_id, name, quantity, unit, is_bought, department) |
| `shopping_list_event` | Append-only log of shopping-list changes (add_recipe, remove_recipe, add_item, remove_item, clear_list) — powers Dave's recent/favorite recipe suggestions |
| `account` | Shared account aggregate |
| `account_user` | User ↔ account join (user_id is Auth0 string ID) |
| `invite` | Email invitations with expiring tokens |
| `user` | Auth0-backed user identity, plus per-user flags: `onboarded` and `show_pantry_staples` (view preference — see CONTEXT.md's Pantry Staple) |

## Component Structure

Components are organized by feature with index files:
- `components/layout/`: Page layout, header, Grid/Sidebar/MainContent wrappers
- `components/recipe/`: Individual recipe display and editing
- `components/recipe-form/`: Full recipe editor (ingredients, tags, image upload)
- `components/method-import/`: Fills an existing Recipe's Method from a link or a photo, rendered inside the recipe editor in edit mode only (see CONTEXT.md's Method Import)
- `components/recipe-list/`: Browsable/searchable list of user recipes
- `components/shopping-list/`: ShoppingList display + Recipes selector sub-components
- `components/identity/`: Auth0 login/logout/create account buttons
- `components/dave-chat/`: Conversational chat UI for Dave AI assistant
- `components/invite/`: Invite card for account sharing flow
- `components/button/`, `components/message/`, `components/svg/`: Shared UI primitives
- Each directory typically has `index.js` and a CSS module

## Pages & Features

| Page | File | Purpose |
|------|------|---------|
| Landing | `pages/index.js` | Public page; login/register or "Start Building List" link |
| Shopping List | `pages/list.js` | Select recipes → auto-generate aggregated shopping list |
| Recipes | `pages/recipes/index.js` | View, edit, and curate recipe collection |
| New Recipe | `pages/recipes/new.js` | Add recipe via URL/photo/manual entry (see CONTEXT.md's Recipe Import) |
| Account | `pages/account.js` | Invite others, manage members, accept/reject invitations |
| Dave (AI chat) | `pages/dave.js` | Conversational meal planner powered by GPT-3.5-turbo |

## Custom Hooks

| Hook | Purpose |
|------|---------|
| `use-recipes.js` | Fetch all recipes for current user |
| `use-recipe.js` | Fetch single recipe by ID |
| `use-viewport.js` | Track window width for responsive design |
| `use-interval.js` | `setInterval` wrapper that pauses when page is hidden |
| `use-page-visibility.js` | Detect `document.visibilityState` changes |

## Data Fetching & Cache Invalidation

Server state goes through TanStack Query, with one `QueryClient` created per app
instance in `pages/_app.tsx`. No `staleTime` is configured, so the default of `0`
applies: cached data is stale the moment it arrives and any remount refetches.

**Every cached `queryKey` is defined in `lib/query-keys.ts`.** Keys have two
authors — the hook that reads one and the mutation that invalidates it — and a
key that drifts between the two fails silently: it simply stops invalidating.
The registry also normalises `queryKeys.recipe(id)` to a string, because reads
pass the router param (a string) while writes pass `Recipe.id` (a number), and
TanStack Query hashes keys structurally, so `['recipe', 5]` and `['recipe', '5']`
would be unrelated cache entries.

### The convention

**Every mutation states its cache effect, including when that effect is
"nothing".** A mutation with no `onSuccess` should carry a comment saying why,
so the next reader can tell a decision from an oversight. Invalidate only what
the mutation actually changes on the server — this app re-renders plenty, and a
reflexive sweep trades silent staleness for pointless refetches.

**Do not rely on a redirect to refresh the cache.** Most mutations here navigate
afterwards, and a remount does refetch. But it serves the *stale* entry first
and refetches behind it, so the just-saved data is briefly missing or wrong —
and the coupling breaks the moment a mutation stops navigating.

| Mutation | Invalidates | Why |
|----------|-------------|-----|
| Save Recipe (`components/recipe-form/Form.tsx`) | `['recipes']`, `['units']`, plus `['recipe', id]` when editing | Summary list carries name/tags; a save upserts every Unit its ingredients reference (`insertUnits`), so it can create one the cached list lacks |
| Delete Recipe (same file) | `['recipes']`; **removes** `['recipe', id]` | Removed rather than invalidated — refetching a deleted Recipe would 404. Removing is safe with an observer still mounted: it keeps rendering its last value rather than refetching |
| Accept invite (`pages/account.tsx`) | *everything* (`invalidateQueries()`) | Accepting moves the user into a different Account, so every cached query describes the Account they just left |
| Reject invite (same file) | `['invites']` | The invite is deleted server-side |
| Send invite (same file) | nothing | `GET /invites` returns invites addressed to *this* user; sending one creates a row for someone else |
| Parse URL / photo / pasted text (`pages/recipes/new.tsx`, `Form.tsx`) | nothing | Extraction only. The Ingredients and Units an import introduces are created when the Recipe is saved, and it is the save that invalidates |
| Save user, complete onboarding (`pages/index.tsx`) | nothing | No cached query reads User state |
| Shopping List: buy, regenerate, clear, add extra (`pages/list.tsx`) | nothing | See below |

`['tags']` is never invalidated: `GET /tags` reads the `tag` table, a fixed list
the app never inserts into. Saving a Recipe only writes `recipe_tag` join rows.

`['recipe-image-job', jobId]` is polled per job until it settles, never shared
between call sites and never invalidated.

### Why the Shopping List is not in the cache

`pages/list.tsx` holds its state in `useState` rather than a query, deliberately:

- Nothing outside that page reads Shopping List data, so there is no second
  consumer to keep in sync — the problem a shared cache exists to solve. The
  staleness that motivated this convention (`['recipes']`, `['units']`) is real
  precisely because those *are* read from several places.
- The regenerate call returns the recomputed list, so the page already receives
  authoritative server state on every change that alters it.
- Buying an item and adding an Extra Item are deliberately optimistic. Through a
  cache that becomes the same optimistic write via `setQueryData` plus rollback
  plumbing, to reach the behaviour the local update already has.

Deleting a Recipe that is on the list needs no invalidation either: the list is
stored server-side by recipe id and re-read on mount, so it self-corrects.

## Environment Variables

**Development (`.env.development`):**
```
NEXT_PUBLIC_API_HOST=http://localhost:8080/api/bigshop
API_HOST_INTERNAL=http://localhost:8080/api/bigshop
NEXT_PUBLIC_AUTH0_DOMAIN=dev-x-n37k6b.eu.auth0.com
NEXT_PUBLIC_AUTH0_CLIENT_ID=HxkTOH3ZYxjbsgrVI4ii1CV2TQx7hk9G
NEXT_PUBLIC_AUTH0_AUDIENCE=https://big-shop-api
NEXT_PUBLIC_HOST=http://localhost:3000
DISABLE_AUTH=false
```

**Production (`.env.production`, overridden by Netlify's own environment variables):**
```
NEXT_PUBLIC_API_HOST=/api/bigshop
API_HOST_INTERNAL=https://big-shop-api.fly.dev/api/bigshop
NEXT_PUBLIC_HOST=https://www.bigshop.life
```

`@next/env` never replaces a key already present in `process.env`, so anything set in the
Netlify UI wins over this file. That is what makes the UI the control surface and this the
default — and why rolling the API cutover back means changing the UI values, not this file.

### Telemetry variables, and which of them are secret

Set in the Netlify UI, not committed. Three runtimes, three different shapes,
because the trust boundary is different in each.

| Variable | Read by | Secret? |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | the OTel SDK in the **Netlify functions** (`lib/telemetry/setup.ts`) | no, but pointless alone |
| `OTEL_EXPORTER_OTLP_HEADERS` | the same SDK — `Authorization=Basic <base64 of instanceID:token>` | **yes** |
| `NEXT_PUBLIC_FARO_COLLECTOR_URL` | Faro, in the **browser** (`lib/telemetry/faro.ts`) | no — see below |
| `FARO_APP_ID`, `FARO_STACK_ID` | `scripts/upload-sourcemaps.sh`, at **build time** | no |
| `FARO_API_KEY` | the same script | **yes** |

Two things worth stating plainly.

**The Faro collector URL is public by construction**, and its `NEXT_PUBLIC_`
prefix is correct rather than an oversight: every visitor's browser posts to it,
so it is in the bundle whatever we do. It embeds an app key, which is an
ingestion identifier and not a credential — it grants writing telemetry to one
Faro app and nothing else.

**`OTEL_EXPORTER_OTLP_HEADERS` and `FARO_API_KEY` must never gain a
`NEXT_PUBLIC_` prefix.** Next inlines every such variable into the client
bundle, so prefixing either would publish a Grafana Cloud credential to every
visitor. This is the same trap `lib/api-host.ts` documents for
`API_HOST_INTERNAL`, with a worse payoff.

**Setting any of them requires a rebuild to take effect.** Netlify resolves
environment variables into the function bundle and the client bundle at *deploy*
time, so an existing deploy never picks up a variable added afterwards. This is
not obvious and has already cost one confused debugging session — see the Phase 4
notes in `specs/observability.state.md`.

The Go API's telemetry is configured separately, as Fly secrets on the collector
sidecar rather than on the app — `docs/adr/0007-observability-otel-grafana-cloud.md`
and the Session 2 notes in the same state file.

### `NEXT_PUBLIC_HOST` is a fallback, not the app's origin

Every `NEXT_PUBLIC_*` value is inlined into the bundle at build time, so this one
says `https://www.bigshop.life` in *every* production-mode build — Netlify deploy
previews included. Using it as the origin meant a preview sent its Auth0
`redirect_uri` and its logout `returnTo` to the live site, and called
production's `/api/parse-recipe-url` and friends cross-origin. The browser now
reads `window.location.origin` via `lib/app-origin.ts`, and calls to this app's
own API routes use a relative path. `NEXT_PUBLIC_HOST` remains as the SSR
fallback and as `scripts/backfill-recipe-method.mjs`'s default web origin.

Full account, including the Auth0 allowlist entries that previews also need →
[docs/deploy-previews.md](./docs/deploy-previews.md).

### The two API host variables

They are the same value locally and deliberately different in production, and
getting them confused is the sharpest edge in the whole Fly migration.

| | Read by | Production value |
|---|---|---|
| `NEXT_PUBLIC_API_HOST` | `lib/api-client.ts`, in the **browser** | `/api/bigshop` — relative. Netlify rewrites it to the Fly origin (`netlify.toml`), so the API stays same-origin and there is no CORS |
| `API_HOST_INTERNAL` | `lib/authenticate.ts`, `lib/dave/tools.ts`, `lib/recipe-import/known-names.ts`, in **Netlify functions** | `https://big-shop-api.fly.dev/api/bigshop` — absolute, straight to Fly |

A relative URL has no origin to be relative to inside a Node process, so a server-side
caller left on `NEXT_PUBLIC_API_HOST` does not merely run slowly — it throws. All three
read it through `serverApiHost()` in [`lib/api-host.ts`](./lib/api-host.ts), which prefers
`API_HOST_INTERNAL` and falls back to `NEXT_PUBLIC_API_HOST` (that fallback is what keeps
local development and e2e working, where the public value is absolute anyway).

**`API_HOST_INTERNAL` must never gain a `NEXT_PUBLIC_` prefix.** Next.js inlines every
`NEXT_PUBLIC_*` variable into the client bundle at build time, which would publish the
unproxied origin to every visitor and undo the same-origin property.

**Server-side secrets (set in Netlify UI / local `.env.local`):**
- `DSN` — TiDB connection string
- `OPENAI_API_KEY` — GPT-4 Vision + GPT-3.5-turbo
- `SENDGRID_API_KEY` — Email invitations
- `AUTH0_DOMAIN` / `AUTH0_AUDIENCE` — Go JWT validation

**Fly secrets, read by the Go API only** (`fly secrets set …`, see the
[runbook](./docs/fly-migration-runbook.md)):
- `NETLIFY_PURGE_TOKEN` — a Netlify personal access token, used to purge the edge cache
- `NETLIFY_SITE_ID` — the Netlify site's API ID, sent with each purge

Both are **optional**. With either unset the purger is a no-op — which is what local
development, e2e and CI run as — and `/units` simply falls back to expiring on its
`s-maxage`. See Caching below.

## Caching

Every API response carries a `Cache-Control` header. The default, set by middleware in
`internal/pkg/app/app.go` ahead of everything else in the negroni stack, is
`private, no-store`; 22 of the 25 registered operations are account-scoped and want exactly
that, and so does anything added later.

Three routes override it, each differently — the reasoning is in
[ADR-0009](./docs/adr/0009-edge-caching-the-global-catalogs.md) and the audit that produced
it is `follow-ups.md` #44:

| Route | `Cache-Control` | Notes |
|---|---|---|
| `GET /tags` | `public, max-age=0, s-maxage=86400` | `tag` is seeded by migration and never written to, so nothing purges it |
| `GET /units` | `public, max-age=0, s-maxage=300` | Also `Netlify-Cache-Tag: units`. Purged on Recipe create/edit, since both can coin a Unit |
| `GET /ingredients` | `no-store` | Read server-side via `API_HOST_INTERNAL`, so it never crosses the edge and caching buys nothing |

Netlify does not cache proxied responses without a cache header, so before this the edge
cached nothing and every catalog read crossed to Frankfurt.

**`public` must never reach an account-scoped route** — `Authorization` is not part of
Netlify's cache key, so one Account's response would be served to the next caller.
`TestOnlyTheGlobalCatalogsOverrideTheDefault` walks the registered operations and fails if
the set of overriding routes grows.

The purge itself (`internal/pkg/purge`) is asynchronous, best-effort and **must never fail
a Recipe save**. It also coalesces: Netlify 429s a tag purged more than twice in five
seconds, which a burst of saves or a `scripts/backfill-recipe-method.mjs` re-run would
otherwise hit. The `s-maxage` is what makes a missed purge self-heal.

## Deployment

Two independent pipelines, one per deployable — an accepted consequence of
[ADR-0006](./docs/adr/0006-go-api-leaves-netlify-functions.md).

**Next.js site — Netlify**, automatically on git push.
- Build command: `./build.sh`, which is now just `npm run package`
- Publish directory: `.next`
- Next.js Runtime: `@netlify/plugin-nextjs` v5 (pinned as a devDependency so
  `netlify.toml`'s `[[plugins]]` entry resolves during the deploy build). v5 is
  required for Next.js 13.5+; the v4 runtime only supported Next.js 10–13.4
- Environment: Node 22 (`.node-version`, matching both CI workflows; Next.js 16 requires >=20.9.0), Go 1.25 (`netlify.toml` `GO_VERSION`, matches `go.mod`)
- `GO_VERSION` is still needed even though `build.sh` no longer runs anything Go:
  Netlify goes on compiling the `netlify-functions/recipes` Lambda on every deploy
  throughout the migration's cooling-off period, because that Lambda is the rollback
  target. Phase 5 deletes the function and the pin together

**Go API — Fly.io** (`big-shop-api`, region `fra`), by
`.github/workflows/deploy-api.yml` on push to `master`.
- Gated on the CI workflow succeeding, so a commit that fails `go test` or a drift
  check is never deployed
- Config: `netlify-functions/recipes/fly.toml`; image:
  `netlify-functions/recipes/Dockerfile`
- Needs a `FLY_API_TOKEN` repository secret; `DSN` and `SENDGRID_API_KEY` are Fly
  secrets, `AUTH0_DOMAIN`/`AUTH0_AUDIENCE` are in `fly.toml`'s `[env]`
- Reached from the browser through a Netlify `status = 200` rewrite, so it stays
  same-origin. Server-side callers address it directly
- First-time setup, cutover and rollback:
  [`docs/fly-migration-runbook.md`](./docs/fly-migration-runbook.md)

## Key Dependencies

**Frontend:** `next@16`, `react@19`, `@tanstack/react-query`, `@auth0/auth0-react@2`, `openai`, `@netlify/blobs`

**Backend (Go):** `gorilla/mux`, `auth0/go-jwt-middleware`, `aws/aws-lambda-go`, `go-sql-driver/mysql`, `sendgrid/sendgrid-go`, `urfave/negroni`
