import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import Analytics from './index';
import { writeConsent } from '../../lib/consent';

// The wiring between the consent decision, the router and lib/analytics/ga.
// ga.ts's own tests cover what it sends; these cover *when* it is asked to.

const ga = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  trackPageView: vi.fn(),
  setAccount: vi.fn(),
}));
vi.mock('../../lib/analytics/ga', () => ga);

const routerState = vi.hoisted(() => ({
  route: '/list',
  asPath: '/list',
  handlers: new Set<() => void>(),
}));

// Getters rather than a snapshot, mirroring the real thing: Next's router is a
// long-lived object whose properties change under you, and the component reads
// them at call time precisely because of that. A mock that froze the values at
// render time would test a router nobody has.
vi.mock('next/router', () => ({
  useRouter: () => ({
    get route() {
      return routerState.route;
    },
    get asPath() {
      return routerState.asPath;
    },
    events: {
      on: (_: string, fn: () => void) => routerState.handlers.add(fn),
      off: (_: string, fn: () => void) => routerState.handlers.delete(fn),
    },
  }),
}));

const mockUser = vi.hoisted(() => vi.fn());
vi.mock('@hooks/use-user', () => ({ default: mockUser }));

function navigateTo(route: string, asPath = route) {
  routerState.route = route;
  routerState.asPath = asPath;
  routerState.handlers.forEach(fn => fn());
}

beforeEach(() => {
  window.localStorage.clear();
  Object.values(ga).forEach(fn => fn.mockReset());
  routerState.route = '/list';
  routerState.asPath = '/list';
  routerState.handlers.clear();
  mockUser.mockReturnValue(undefined);
});

describe('Analytics', () => {
  it('starts nothing for a visitor who has not been asked', () => {
    render(<Analytics />);

    expect(ga.start).not.toHaveBeenCalled();
    expect(ga.stop).not.toHaveBeenCalled();
    expect(ga.trackPageView).not.toHaveBeenCalled();
  });

  it('starts and reports the current page when consent is already granted', () => {
    writeConsent('granted');
    render(<Analytics />);

    expect(ga.start).toHaveBeenCalledTimes(1);
    expect(ga.trackPageView).toHaveBeenCalledWith('/list', 'Shopping list');
  });

  it('reports each navigation once, with the route template title', () => {
    writeConsent('granted');
    render(<Analytics />);
    ga.trackPageView.mockClear();

    navigateTo('/recipes/[id]', '/recipes/42');
    navigateTo('/recipes', '/recipes');

    expect(ga.trackPageView.mock.calls).toEqual([
      ['/recipes/42', 'Recipe'],
      ['/recipes', 'Recipes'],
    ]);
  });

  // The query string is where a future `?q=<search terms>` would live, and
  // search terms are content.
  it('strips the query string from the reported path', () => {
    writeConsent('granted');
    render(<Analytics />);
    ga.trackPageView.mockClear();

    navigateTo('/recipes/[id]', '/recipes/42?stored=new');

    expect(ga.trackPageView).toHaveBeenCalledWith('/recipes/42', 'Recipe');
  });

  it('does not report the same path twice in a row', () => {
    writeConsent('granted');
    render(<Analytics />);
    ga.trackPageView.mockClear();

    navigateTo('/list', '/list');
    navigateTo('/list', '/list');

    expect(ga.trackPageView).toHaveBeenCalledTimes(0);
  });

  it('reports nothing for a route with no title rather than guessing one', () => {
    writeConsent('granted');
    render(<Analytics />);
    ga.trackPageView.mockClear();

    navigateTo('/some/route/nobody/mapped');

    expect(ga.trackPageView).not.toHaveBeenCalled();
  });

  it('stops when consent is declined', () => {
    writeConsent('denied');
    render(<Analytics />);

    expect(ga.stop).toHaveBeenCalledTimes(1);
    expect(ga.start).not.toHaveBeenCalled();
  });

  // The regression the review found: this effect also depends on the router, so
  // without a transition guard a declined visitor ran the whole withdrawal path
  // - two cookie sweeps and a timer - on every single navigation.
  it('does not re-run the withdrawal on every navigation', () => {
    writeConsent('denied');
    render(<Analytics />);
    expect(ga.stop).toHaveBeenCalledTimes(1);

    navigateTo('/recipes');
    navigateTo('/account');
    navigateTo('/dave');

    expect(ga.stop).toHaveBeenCalledTimes(1);
  });

  it('names the Account once it is known', () => {
    writeConsent('granted');
    mockUser.mockReturnValue({ email: 'dev@localhost', accountId: 7 });
    render(<Analytics />);

    expect(ga.setAccount).toHaveBeenCalledWith(7);
  });
});
