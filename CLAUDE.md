# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture Overview

Big Shop is a recipe management application with a hybrid Next.js frontend and Go API backend:

- **Frontend**: Next.js React application with Auth0 authentication
- **Backend**: Go API deployed as Netlify Functions
- **Database**: TiDB (MySQL-compatible) for production, local MySQL for development
- **Deployment**: Netlify with automatic deployments from git

### Key Components

- `pages/`: Next.js pages with file-based routing
- `components/`: Reusable React components organized by feature
- `hooks/`: Custom React hooks for shared logic
- `netlify-functions/recipes/`: Go API with JWT authentication
- `migrations/`: SQL database schema migrations
- `mocks/`: JSON files for local development without API

### Authentication Flow

The app uses Auth0 for authentication:
- Public route: `/` (landing page)
- All other routes require authentication
- JWT tokens are automatically added to API requests via `use-http` interceptors
- For local development, set `behindAuth` to `false` in `_app.js`

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
   - Set `useMocks` to `true` for mock data

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

## Go API Structure

Located in `netlify-functions/recipes/`:
- `internal/pkg/app/app.go`: Main application setup with JWT middleware
- `internal/pkg/app/*.go`: Feature handlers (recipes, users, shopping lists, etc.)
- Uses Auth0 JWT validation for all endpoints except `/health`
- RESTful API with CRUD operations for recipes, ingredients, shopping lists

### API Testing
For authenticated endpoints, copy Authorization header from browser dev tools since there's no established curl/Postman workflow yet.

## Database

- **Production**: TiDB (MySQL-compatible)
- **Local**: MySQL with manual migration management
- **Migrations**: Located in `migrations/` directory, applied manually
- **Schema**: Users, recipes, ingredients, shopping lists, invitations

## Component Structure

Components are organized by feature with index files:
- `components/layout/`: Page layout and navigation
- `components/recipe*/`: Recipe-related components  
- `components/shopping-list/`: Shopping list functionality
- `components/identity/`: User management
- Each component directory typically contains `index.js` and CSS modules

## Testing

Go API tests are run via:
```bash
cd netlify-functions/recipes
go test ./... -v
```

Frontend testing framework not established.

## Deployment

- Automatic deployment via Netlify on git push
- Build command: `./build.sh` (runs `npm run package` + Go tests)
- Publish directory: `.next`
- Environment: Node 14+ (specified in `.node-version`)

## Useful External Links

- [Netlify Dashboard](https://app.netlify.com/sites/big-shop/overview)
- [TiDB Console](https://tidbcloud.com/console/clusters/10445360365857932862/sqleditor?orgId=1372813089209222715&projectId=1372813089454538934)
- [Auth0 Management](https://manage.auth0.com/dashboard/eu/dev-x-n37k6b/applications/HxkTOH3ZYxjbsgrVI4ii1CV2TQx7hk9G/settings)
- [Trello Backlog](https://trello.com/b/LnaGkQyG/bigshop)