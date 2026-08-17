import { test as base, expect } from '@playwright/test';
import { CONSENT_STORAGE_KEY, serializeConsent } from '../lib/consent';

// Next.js dev mode's build-activity indicator renders into a <nextjs-portal>
// custom element that can sit on top of interactive elements and swallow
// clicks - a `next dev`-only artifact (no production equivalent), and
// exactly the kind of environment noise these tests should not be flaky
// against. Neutralized here, at the test level, rather than in the app.
//
// The cookie banner is the second thing in that category, and it is not an
// artifact at all - it is the app working. It is fixed to the bottom of every
// page until answered, so without this every existing spec would run against a
// viewport with a dialog over the bottom of it, and anything it covered would
// fail to click. So each test starts from a browser that has already declined,
// which is both the quieter default and the one that exercises no analytics.
//
// `seedConsent: false` opts out, for the spec that is actually about the
// banner. See e2e/consent.spec.ts.
//
// The key and the stored shape are both imported from lib/consent rather than
// written out here, and that matters more than it looks. A hand-rolled seed
// stops matching the moment the key, the JSON shape or POLICY_VERSION changes -
// and it does not fail loudly when it does. It just quietly stops counting as a
// decision, so the banner reappears across the whole suite as a scattering of
// unrelated click failures in specs that have nothing to do with consent.

interface ConsentOptions {
  seedConsent: boolean;
}

export const test = base.extend<ConsentOptions & { page: import('@playwright/test').Page }>({
  seedConsent: [true, { option: true }],

  page: async ({ page, seedConsent }, use) => {
    await page.addInitScript(() => {
      const inject = () => {
        const style = document.createElement('style');
        // The portal's shadow root has its own internal styles that
        // explicitly set pointer-events: auto on the overlay content,
        // which (as shadow-encapsulated explicit styles) wins over anything
        // inherited from outside - display:none removes the box from the
        // render tree entirely instead, which no explicit inner style can
        // override.
        style.textContent = 'nextjs-portal { display: none !important; }';
        document.documentElement.appendChild(style);
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inject);
      } else {
        inject();
      }
    });

    if (seedConsent) {
      // Written through the same key and shape lib/consent.ts reads, rather
      // than by driving the banner: a UI click per test would make every spec
      // depend on the banner's markup, which is the coupling this avoids.
      await page.addInitScript(
        ({ key, value }: { key: string; value: string }) => {
          try {
            window.localStorage.setItem(key, value);
          } catch {
            // Storage unavailable in this context; the banner will show and the
            // spec that cares about it will say so.
          }
        },
        { key: CONSENT_STORAGE_KEY, value: serializeConsent('denied') }
      );
    }

    await use(page);
  },
});

export { expect };
