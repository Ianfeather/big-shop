import { test as base, expect } from '@playwright/test';

// Next.js dev mode's build-activity indicator renders into a <nextjs-portal>
// custom element that can sit on top of interactive elements and swallow
// clicks - a `next dev`-only artifact (no production equivalent), and
// exactly the kind of environment noise these tests should not be flaky
// against. Neutralized here, at the test level, rather than in the app.
export const test = base.extend<{ page: import('@playwright/test').Page }>({
  page: async ({ page }, use) => {
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
    await use(page);
  },
});

export { expect };
