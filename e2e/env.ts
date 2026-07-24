// Ports pinned (rather than left to dev-full.sh's auto-increment-on-collision
// behavior) so Playwright's webServer health check and baseURL agree on
// exactly where the stack will come up. Distinct from dev-full.sh's own
// defaults (3000/8080/3308) so a manually-running `npm run dev:full` in the
// same worktree doesn't collide with the one Playwright starts for e2e.
export const WEB_PORT = 3900;
export const API_PORT = 8980;
export const DB_PORT = 3908;

export const BASE_URL = `http://localhost:${WEB_PORT}`;
export const API_HOST = `http://localhost:${API_PORT}/.netlify/functions/recipes`;

// See CLAUDE.md's "Multiple worktrees" section: docker compose derives its
// project name from the directory basename by default, and every worktree of
// this repo is checked out into a directory named `big-shop` - an explicit,
// e2e-specific project name stops Playwright's stack from colliding with
// (or silently reusing) another worktree's containers.
export const COMPOSE_PROJECT_NAME = 'bigshop-e2e';
