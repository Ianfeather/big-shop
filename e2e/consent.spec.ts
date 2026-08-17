import { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CONSENT_STORAGE_KEY } from '../lib/consent';

// The cookie banner, against the real app. The unit tests in
// components/consent-banner cover the state machine; what only this level can
// show is that a decision survives a real page load, which is the entire point
// of storing it.
//
// Opts out of the suite-wide seed - every other spec starts from a browser that
// has already declined, precisely so the banner is not in the way. See
// e2e/fixtures.ts.
test.use({ seedConsent: false });

// Driven from /privacy rather than from the marketing homepage, and that is
// forced by the environment rather than a preference. The e2e stack runs with
// NEXT_PUBLIC_DISABLE_AUTH=true, under which hooks/use-auth.ts's mock reports
// `isAuthenticated: true` unconditionally - so '/' immediately redirects an
// "already onboarded" user to /list and the marketing page never settles.
// /privacy is the one public page that renders the same either way, and it
// carries the same footer control.
const PUBLIC_PAGE = '/privacy';

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Cookies' });

test.describe('cookie consent', () => {
  test('is asked once, and a decline sticks across a reload', async ({ page }) => {
    await page.goto(PUBLIC_PAGE);
    await expect(dialog(page)).toBeVisible();

    await page.getByRole('button', { name: 'Decline analytics' }).click();
    await expect(dialog(page)).toBeHidden();

    // The assertion that matters: a reload is where a decision kept only in
    // React state would be forgotten and the banner would ask all over again.
    await page.reload();
    await expect(dialog(page)).toBeHidden();
    expect(await storedDecision(page)).toBe('denied');
  });

  test('accepting sticks too', async ({ page }) => {
    await page.goto(PUBLIC_PAGE);
    await page.getByRole('button', { name: 'Accept analytics' }).click();

    await page.reload();
    await expect(dialog(page)).toBeHidden();
    expect(await storedDecision(page)).toBe('granted');
  });

  test('can be reopened from the footer and the decision withdrawn', async ({ page }) => {
    await page.goto(PUBLIC_PAGE);
    await page.getByRole('button', { name: 'Accept analytics' }).click();
    expect(await storedDecision(page)).toBe('granted');

    await page.getByRole('button', { name: 'Cookie settings' }).first().click();
    await expect(dialog(page)).toBeVisible();

    await page.getByRole('button', { name: 'Decline analytics' }).click();
    await expect(dialog(page)).toBeHidden();
    expect(await storedDecision(page)).toBe('denied');
  });

  // The banner asks you to decide on the basis of a policy, so the policy has
  // to be readable *before* you have decided. This is also the regression test
  // for /privacy having originally sat behind the auth gate, where a logged-out
  // visitor following the link was bounced back to the homepage.
  test('the privacy policy is readable while the question is still open', async ({ page }) => {
    await page.goto(PUBLIC_PAGE);

    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('What we store');
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByRole('link', { name: /what we store/i })).toHaveAttribute(
      'href',
      '/privacy'
    );
  });
});

async function storedDecision(page: Page): Promise<string | undefined> {
  return page.evaluate((key: string) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw).analytics : undefined;
  }, CONSENT_STORAGE_KEY);
}
