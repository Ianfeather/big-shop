import { request } from '@playwright/test';
import { API_HOST } from './env';
import { POLICY_VERSION } from '../lib/consent';

// Records the same decision the per-test seed writes, once, before any spec
// runs.
//
// **Why this is needed at all**, because it is not obvious and the failure it
// prevents looks like a bug in the application rather than in the harness.
//
// Under `DISABLE_AUTH` every request resolves to the same `local-dev-user`, so
// the consent record is a single row shared by the entire run - the same
// property CLAUDE.md documents for the Shopping List, but worse, because every
// spec touches this one. `e2e/fixtures.ts` seeds `denied` into localStorage so
// the banner is out of the way, and the moment any spec loads an authenticated
// page, components/consent-sync notices the server has no record and pushes
// that seeded `denied` up. With ~26 tests running in parallel that is ~26
// racing writers, and `e2e/consent.spec.ts`'s own assertions lose.
//
// Seeding the server with the same answer removes the race rather than papering
// over it: the reconcile then finds server and browser already agreeing, so no
// spec pushes anything, and the consent spec is the only writer. It is also the
// honest steady state - a returning user whose decision is already recorded.
//
// The e2e stack drops its volumes on every run (`test:e2e:stop --volumes`), so
// this starts from an empty `consent_event` every time.
async function globalSetup() {
  // webServer readiness is Playwright's job, but the ordering of globalSetup
  // against it has changed between versions and this needs the API rather than
  // the web server anyway. Polling is cheap and removes the dependency on which
  // way round it happens to be.
  const context = await request.newContext();
  const deadline = Date.now() + 60_000;

  for (;;) {
    // Only the *request* is retried. A reachable API answering non-2xx is a
    // real failure - a wrong enum value, say - and must surface immediately
    // rather than being retried for a minute and then reported as a timeout,
    // which is what happens if the throw sits inside the catch's own try.
    let response;
    try {
      response = await context.post(`${API_HOST}/consent`, {
        data: { analytics: false, policyVersion: POLICY_VERSION, source: 'login-sync' },
      });
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await new Promise(resolve => setTimeout(resolve, 1000));
      continue;
    }

    if (response.ok()) break;
    throw new Error(`seeding consent failed: ${response.status()} ${await response.text()}`);
  }

  await context.dispose();
}

export default globalSetup;
