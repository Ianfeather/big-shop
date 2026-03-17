# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
- `pages/api/`: Next.js serverless API routes (image recognition, Dave chat, recipe scrapers)

### Authentication Flow

The app uses Auth0 for authentication:
- Public route: `/` (landing page)
- All other routes require authentication
- JWT tokens are automatically added to API requests via `use-http` interceptors
- For local development, set `DISABLE_AUTH=true` in `.env.local`

## Development Commands

### Frontend Development
```bash
npm run dev          # Start Next.js development server
npm run build        # Build production frontend
npm run start        # Start production server
npm run lint         # Run ESLint
npm run package      # Lint and build (used in deployment)
```

### Full Stack Development
```bash
./build.sh           # Build frontend + run Go tests (production build)
```

### Local Development Setup

1. **Disable authentication** for UI-only development:
   - Set `DISABLE_AUTH=true` in `.env.local` (for offline development)
   - Set `USE_MOCKS=true` for mock data instead of API calls

2. **Database setup** (when needed):
   ```bash
   mysql -u root
   use bigshop;
   ```
   Create admin user:
   ```sql
   CREATE USER 'admin'@'localhost' IDENTIFIED BY 'admin';
   GRANT ALL PRIVILEGES ON bigshop.* TO 'admin'@'localhost';
   ```

3. **Environment variables**:
   - Copy from `.env.development` for local development
   - Auth0 credentials required for authentication flow
   - `OPENAI_API_KEY` required for AI features
   - `SENDGRID_API_KEY` required for email invitations

## Pages & Features

| Page | File | Purpose |
|------|------|---------|
| Landing | `pages/index.js` | Public page; login/register or "Start Building List" link |
| Shopping List | `pages/list.js` | Select recipes → auto-generate aggregated shopping list |
| Recipes | `pages/recipes/index.js` | View, edit, and curate recipe collection |
| New Recipe | `pages/recipes/new.js` | Add recipe via photo upload (AI extraction) or manual form |
| Account | `pages/account.js` | Invite others, manage members, accept/reject invitations |
| Dave (AI chat) | `pages/dave.js` | Conversational meal planner powered by GPT-3.5-turbo |

### Key User Workflows

1. **Add a recipe**: Upload photo → GPT-4 Vision extracts name/ingredients/instructions → confirm and save
2. **Plan meals**: Browse recipes → select ones for the week → shopping list auto-generated with unit aggregation
3. **Go shopping**: Check off items as bought; add extra one-off items; clear list when done
4. **Share account**: Invite by email → invitee accepts → both users share the same recipe/list data

## Go API Structure

Located in `netlify-functions/recipes/`:
- `main.go`: Lambda entry point, TiDB connection, Negroni router setup
- `internal/pkg/app/app.go`: App struct, JWT middleware, all route definitions
- `internal/pkg/app/*.go`: Feature handlers

### Full Route List

```
GET    /health
GET    /recipes
GET    /recipe/{slug}
GET    /recipe/{id}
POST   /recipe
PUT    /recipe
DELETE /recipe
GET    /ingredients
GET    /tags
GET    /units
GET    /shopping-list
POST   /shopping-list
PATCH  /shopping-list/buy
POST   /shopping-list/extra
DELETE /shopping-list/clear
GET    /shopping-list/history
GET    /account
POST   /account/add
DELETE /account/remove
POST   /user
POST   /invite
GET    /invites
POST   /invite/accept
POST   /invite/reject
```

All routes (except `/health`) require Auth0 JWT validation. The user ID is extracted from the JWT `sub` claim and threaded through context to handlers.

### API Testing
For authenticated endpoints, copy the `Authorization` header from browser dev tools — no established curl/Postman workflow exists yet.

## Next.js API Routes (pages/api/)

| Route | File | Purpose |
|-------|------|---------|
| `/api/recipe-image` | `recipe-image.mjs` | GPT-4 Vision: photo → structured recipe JSON (async, polled) |
| `/api/dave/chat` | `dave/chat.js` | GPT-3.5-turbo chat with tool calling (search/get/create shopping list) |
| `/api/third-parties/*` | `third-parties/` | Scrapers for Simply Recipes, BBC Good Food, Epicurious, Delish, Food Network |

The recipe image extraction uses Netlify Blobs to store async job results; the frontend polls every 2 seconds until complete.

## Database Schema

Production: TiDB (MySQL-compatible). Migrations in `migrations/` applied manually.

| Table | Purpose |
|-------|---------|
| `recipe` | Recipe records (id, name, slug, remote_url, user_id) |
| `ingredient` | Canonical ingredient names |
| `unit` | Measurement units (gram, litre, teaspoon, packet, etc.) |
| `part` | Recipe ↔ ingredient join (recipe_id, ingredient_id, unit_id, quantity) |
| `tag` | Recipe tags (Vegetarian, Batch Cook, etc.) |
| `recipe_tag` | Recipe ↔ tag join |
| `department` | Ingredient categories (vegetables, meat and fish, other) |
| `ingredient_department` | Ingredient ↔ department join |
| `list` | Shopping list items (user_id, name, quantity, unit, is_bought, department) |
| `shopping_list_history` | Snapshots of completed shopping lists |
| `account` | Shared account aggregate |
| `account_user` | User ↔ account join (user_id is Auth0 string ID) |
| `invite` | Email invitations with expiring tokens |
| `user` | Legacy user table (superseded by Auth0 identity) |

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

## Custom Hooks

| Hook | Purpose |
|------|---------|
| `use-recipes.js` | Fetch all recipes for current user |
| `use-recipe.js` | Fetch single recipe by ID |
| `use-viewport.js` | Track window width for responsive design |
| `use-interval.js` | `setInterval` wrapper that pauses when page is hidden |
| `use-page-visibility.js` | Detect `document.visibilityState` changes |

## Environment Variables

**Development (`.env.development`):**
```
NEXT_PUBLIC_API_HOST=http://localhost:8080
NEXT_PUBLIC_AUTH0_DOMAIN=dev-x-n37k6b.eu.auth0.com
NEXT_PUBLIC_AUTH0_CLIENT_ID=HxkTOH3ZYxjbsgrVI4ii1CV2TQx7hk9G
NEXT_PUBLIC_AUTH0_AUDIENCE=https://big-shop-api
NEXT_PUBLIC_HOST=http://localhost:3000
DISABLE_AUTH=false
USE_MOCKS=false
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

## Testing

Go API tests:
```bash
cd netlify-functions/recipes
go test ./... -v
```

Frontend testing framework not yet established.

Evals:
```bash
npm run test:evals   # runs evals/run-evals.sh
```

## Deployment

- Automatic deployment via Netlify on git push
- Build command: `./build.sh` (runs `npm run package` + Go tests)
- Publish directory: `.next`
- Environment: Node 14+ (`.node-version`), Go 1.14

## Key Dependencies

**Frontend:** `next@14`, `react@18`, `@auth0/auth0-react`, `use-http`, `react-autosuggest`, `openai`, `@netlify/blobs`

**Backend (Go):** `gorilla/mux`, `auth0/go-jwt-middleware`, `aws/aws-lambda-go`, `go-sql-driver/mysql`, `sendgrid/sendgrid-go`, `urfave/negroni`

## Useful External Links

- [Netlify Dashboard](https://app.netlify.com/sites/big-shop/overview)
- [TiDB Console](https://tidbcloud.com/console/clusters/10445360365857932862/sqleditor?orgId=1372813089209222715&projectId=1372813089454538934)
- [Auth0 Management](https://manage.auth0.com/dashboard/eu/dev-x-n37k6b/applications/HxkTOH3ZYxjbsgrVI4ii1CV2TQx7hk9G/settings)
- [Trello Backlog](https://trello.com/b/LnaGkQyG/bigshop)
