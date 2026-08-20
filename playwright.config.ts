import { defineConfig, devices } from '@playwright/test';
import { WEB_PORT, API_PORT, DB_PORT, BASE_URL, COMPOSE_PROJECT_NAME } from './e2e/env';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // Records the dev user's consent once, matching what e2e/fixtures.ts seeds
  // into every browser. Without it, every spec's first authenticated page load
  // races to push that seeded decision to the one row `DISABLE_AUTH` gives the
  // whole run. See e2e/global-setup.ts.
  globalSetup: './e2e/global-setup.ts',
  retries: process.env.CI ? 1 : 0,
  // Locally, 'list' is enough - failures are visible right in the terminal.
  // In CI there's no terminal to look back at, so also write an HTML report
  // (with the trace viewer for any 'on-first-retry' traces) that the
  // workflow uploads as an artifact.
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
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
    // Generous because on a cold CI runner almost none of this is the app
    // starting. A measured failing run spent ~110s of its 120s budget before
    // MySQL had even been asked to start: pulling mysql:8.0 (129MB) and
    // building the Go API image from scratch, with `docker compose up`
    // reporting "Container bigshop-e2e-db-1 Waiting" as the clock ran out.
    // Locally both are cached and the whole thing is up in seconds, which is
    // why this only ever failed in CI - and it did so on unrelated branches
    // too, at roughly one run in four.
    //
    // Raising the ceiling costs nothing in the normal case: Playwright polls
    // `url` and proceeds the moment it answers. It only changes how long a
    // genuinely stuck stack is given - and the common cause of that, a
    // migration that failed to apply, now makes `docker compose up` exit
    // non-zero rather than hang, so dev-full.sh fails fast instead of
    // burning the budget.
    timeout: 300_000,
    env: {
      WEB_PORT: String(WEB_PORT),
      API_PORT: String(API_PORT),
      DB_PORT: String(DB_PORT),
      COMPOSE_PROJECT_NAME,
      // No observability stack for e2e: nothing here asserts on telemetry, and
      // grafana/otel-lgtm is a ~1GB image whose pull would be added to every CI
      // run to prove nothing. The empty endpoint turns the SDK off inside the
      // Go API too, so there are no background exporters retrying against a
      // collector that was never started. See scripts/dev-full.sh.
      START_LGTM: 'false',
      OTEL_EXPORTER_OTLP_ENDPOINT: '',
    },
  },
});
