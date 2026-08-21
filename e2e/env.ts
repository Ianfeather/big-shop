// Ports and the docker compose project name are derived per worktree in
// `e2e/instance.cjs` - see that file for why they are computed rather than
// pinned to literals, and why it is CommonJS. This module is only the typed
// front door onto it, plus the two URLs built from those ports.
//
// Pinned *within* a worktree (rather than left to dev-full.sh's
// auto-increment-on-collision behavior) so Playwright's webServer health check
// and baseURL agree on exactly where the stack will come up; distinct *across*
// worktrees so two e2e runs never share containers, ports or volumes.
import instance from './instance.cjs';

export const WEB_PORT: number = instance.WEB_PORT;
export const API_PORT: number = instance.API_PORT;
export const DB_PORT: number = instance.DB_PORT;
export const COMPOSE_PROJECT_NAME: string = instance.COMPOSE_PROJECT_NAME;

export const BASE_URL = `http://localhost:${WEB_PORT}`;
export const API_HOST = `http://localhost:${API_PORT}/api/bigshop`;
