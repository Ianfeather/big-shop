import { defineConfig, devices } from '@playwright/test';
import { WEB_PORT, API_PORT, DB_PORT, BASE_URL, COMPOSE_PROJECT_NAME } from './e2e/env';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  // Next.js dev compiles each route on-demand on its first request, and Air
  // (the Go API's hot-reloader) does its own rebuild on first hit too - both
  // are cold-start costs specific to `next dev`/`dev:full`, not the app being
  // slow. The default 30s per-test budget can get eaten by that on a route's
  // first visit, especially with several workers hitting different fresh
  // routes at once right after the webServer's health check passes.
  timeout: 60_000,

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // Unset by default (fast, for the normal test:e2e path). Set via
    // `npm run test:e2e:debug` to slow every action down enough to follow
    // along in a headed browser.
    launchOptions: {
      slowMo: process.env.E2E_SLOWMO ? Number(process.env.E2E_SLOWMO) : undefined,
    },
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  // Under DISABLE_AUTH every request resolves to the same fixed dev user and
  // Account, so the Shopping List is a single shared resource across the
  // whole run - see e2e/shopping-list.spec.ts for how that's handled.
  webServer: {
    command: 'npm run dev:full',
    url: `${BASE_URL}/recipes`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      WEB_PORT: String(WEB_PORT),
      API_PORT: String(API_PORT),
      DB_PORT: String(DB_PORT),
      COMPOSE_PROJECT_NAME,
    },
  },
});
