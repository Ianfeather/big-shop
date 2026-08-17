import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KNOWN_ROUTES, pageTitleFor } from './page-titles';

// The exhaustiveness test the page_title rule depends on.
//
// It reads the pages directory rather than taking a hand-written list, because a
// hand-written list is the same failure as a hand-written title: it goes stale
// the moment somebody adds a route, silently, and the whole point is that a new
// route cannot quietly start reporting `document.title`.
//
// In the spirit of lib/telemetry/faro.ts exporting `scrub` for its test - a rule
// this easy to regress without noticing is worth asserting on.

const PAGES_DIR = join(__dirname, '..', '..', 'pages');
const PAGE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];

// Every route Next will serve from pages/, as router.route templates.
function routesFromDisk(dir: string = PAGES_DIR): string[] {
  const routes: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      // `api/` is serverless functions, not pages a browser navigates to.
      if (entry.name === 'api') continue;
      routes.push(...routesFromDisk(full));
      continue;
    }

    // `_app`, `_document` are framework files, not routes. `.test.*`/`.spec.*`
    // are colocated tests - and `.mts` tests are deliberately invisible to Next
    // (see CLAUDE.md), so they are not routes either.
    if (entry.name.startsWith('_')) continue;
    if (/\.(test|spec)\./.test(entry.name)) continue;
    if (!PAGE_EXTENSIONS.some(ext => entry.name.endsWith(ext))) continue;

    const route =
      '/' +
      relative(PAGES_DIR, full)
        .split(sep)
        .join('/')
        .replace(/\.(tsx|ts|jsx|js)$/, '')
        .replace(/(^|\/)index$/, '');

    routes.push(route === '' ? '/' : route);
  }

  return routes;
}

describe('page titles', () => {
  const routes = routesFromDisk();

  it('finds the routes it is meant to be checking', () => {
    // Guards the test itself: a traversal that silently found nothing would
    // make every assertion below vacuously true.
    expect(routes).toContain('/');
    expect(routes).toContain('/recipes/[id]');
    expect(routes.length).toBeGreaterThan(5);
  });

  it.each(routesFromDisk())('has a title for %s', (route) => {
    // If this fails you have added a page. Add it to PAGE_TITLES with a static
    // label. Do not make pageTitleFor fall back to document.title - that is the
    // exact leak this module exists to prevent.
    expect(pageTitleFor(route)).toBeTruthy();
  });

  it('has no titles for routes that no longer exist', () => {
    // The other direction: a stale entry is harmless at runtime but means the
    // list has stopped describing the app, and a list nobody trusts is one
    // nobody maintains.
    expect(KNOWN_ROUTES.sort()).toEqual(routes.sort());
  });

  it('reports nothing for an unmapped route rather than guessing', () => {
    expect(pageTitleFor('/some/route/nobody/added')).toBeUndefined();
  });

  it('names Next.js built-in routes', () => {
    expect(pageTitleFor('/404')).toBe('Not found');
    expect(pageTitleFor('/_error')).toBe('Error');
  });

  // The titles are labels, not user-facing copy - but they must not be *derived*
  // from anything a user typed, which is what this pins.
  it('is a static map with no dynamic segments in any title', () => {
    Object.values(KNOWN_ROUTES).forEach(route => {
      const title = pageTitleFor(route) as string;
      expect(title).not.toMatch(/[[\]{}$]/);
    });
  });
});
