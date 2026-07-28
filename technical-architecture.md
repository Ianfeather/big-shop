# Technical Architecture

For product/domain vocabulary (Account, Recipe, Shopping List, etc.), see [CONTEXT.md](./CONTEXT.md).

## Architecture Overview

Big Shop is a recipe management and meal planning application with a hybrid Next.js frontend and Go API backend:

- **Frontend**: Next.js 14 / React 18 with Auth0 authentication
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
- JWT tokens are automatically added to API requests via `use-http` interceptors
- For local development, set `DISABLE_AUTH=true` in `.env.local`

## Go API Structure

Located in `netlify-functions/recipes/`:
- `main.go`: Lambda entry point, TiDB connection, Negroni router setup
- `internal/pkg/app/app.go`: App struct, JWT middleware, all route definitions (`GetRouter`, ~line 145)
- `internal/pkg/app/*.go`: Feature handlers

**Route list**: routes are registered in `internal/pkg/app/app.go`'s `GetRouter`, using [Huma](https://github.com/danielgtaylor/huma) (`humamux`, on top of the same `gorilla/mux` router) so each operation's request/response types double as its OpenAPI schema - no separate hand-maintained doc to drift. The generated spec is committed at [`docs/openapi.yaml`](./docs/openapi.yaml); regenerate it with `cd netlify-functions/recipes && go run . openapi > ../../docs/openapi.yaml` (no DB needed - route registration never touches it). `build.sh` fails the build if the committed spec is stale relative to `app.go`. All routes except `/health` require Auth0 JWT validation; the user ID is extracted from the JWT `sub` claim and threaded through context to handlers.

### API Testing
For authenticated endpoints, copy the `Authorization` header from browser dev tools — no established curl/Postman workflow exists yet.

## Next.js API Routes (pages/api/)

| Route | File | Purpose |
|-------|------|---------|
| `/api/recipe-image` | `recipe-image.mjs` | GPT-4 Vision: photo → structured recipe JSON (async, polled) |
| `/api/parse-recipe-url` | `parse-recipe-url.js` | Fetches a recipe URL's raw HTML and makes one LLM call to extract name/ingredients/method/vegetarian-ness — works against any recipe site, replacing the older per-site DOM-selector-plus-regex scrapers (formerly `pages/api/third-parties/*`, now deleted) |
| `/api/parse-recipe-text` | `parse-recipe-text.js` | LLM-parses freeform multiline ingredient text (Manual Entry's bulk paste box) into structured ingredient lines |
| `/api/dave/chat` | `dave/chat.js` | GPT-3.5-turbo chat with tool calling (search/get/create shopping list) |

The recipe image extraction uses Netlify Blobs to store async job results; the frontend polls every 2 seconds until complete.

## Database Schema

Production: TiDB (MySQL-compatible). Migrations in `migrations/` applied manually, in order — there is no consolidated schema file, so `migrations/*.sql` (currently 25 files) is the authoritative source for exact columns/constraints.

| Table | Purpose |
|-------|---------|
| `recipe` | Recipe records (id, name, slug, remote_url, account_id) |
| `ingredient` | Canonical ingredient names, plus `base_unit_id` (what its Amounts are added up in) and `display_unit_id` (what a Shopping List shows them as) |
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
| `user` | Auth0-backed user identity |

## Component Structure

Components are organized by feature with index files:
- `components/layout/`: Page layout, header, Grid/Sidebar/MainContent wrappers
- `components/recipe/`: Individual recipe display and editing
- `components/recipe-form/`: Full recipe editor (ingredients, tags, image upload)
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
NEXT_PUBLIC_API_HOST=http://localhost:8080
NEXT_PUBLIC_AUTH0_DOMAIN=dev-x-n37k6b.eu.auth0.com
NEXT_PUBLIC_AUTH0_CLIENT_ID=HxkTOH3ZYxjbsgrVI4ii1CV2TQx7hk9G
NEXT_PUBLIC_AUTH0_AUDIENCE=https://big-shop-api
NEXT_PUBLIC_HOST=http://localhost:3000
DISABLE_AUTH=false
```

**Production (`.env.production`):**
```
NEXT_PUBLIC_API_HOST=https://www.bigshop.life/.netlify/functions/recipes
NEXT_PUBLIC_HOST=https://www.bigshop.life
```

**Server-side secrets (set in Netlify UI / local `.env.local`):**
- `DSN` — TiDB connection string
- `OPENAI_API_KEY` — GPT-4 Vision + GPT-3.5-turbo
- `SENDGRID_API_KEY` — Email invitations
- `AUTH0_DOMAIN` / `AUTH0_AUDIENCE` — Go JWT validation

## Deployment

- Automatic deployment via Netlify on git push
- Build command: `./build.sh` (runs `npm run package` + Go tests)
- Publish directory: `.next`
- Environment: Node 14+ (`.node-version`), Go 1.23 (`netlify.toml` `GO_VERSION`, matches `go.mod`)

## Key Dependencies

**Frontend:** `next@14`, `react@18`, `@auth0/auth0-react`, `use-http`, `react-autosuggest`, `openai`, `@netlify/blobs`

**Backend (Go):** `gorilla/mux`, `auth0/go-jwt-middleware`, `aws/aws-lambda-go`, `go-sql-driver/mysql`, `sendgrid/sendgrid-go`, `urfave/negroni`
