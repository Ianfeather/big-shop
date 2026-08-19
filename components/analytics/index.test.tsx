import type React from 'react';
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
}));

// The component reads `route` and `asPath` during render and reports from an
// effect keyed on them, so a navigation is modelled here as what it is for
// React: a re-render carrying new values. `navigateTo` below does that rather
// than firing an event behind React's back, which is the arrangement that
// reported the previous page - see the component.
vi.mock('next/router', () => ({
  useRouter: () => ({ route: routerState.route, asPath: routerState.asPath }),
}));

const mockUser = vi.hoisted(() => vi.fn());
vi.mock('@hooks/use-user', () => ({ default: mockUser }));

// A navigation is a re-render with new router values, which is what Next does
// and what the reporting effect keys on.
function navigateTo(rerender: (ui: React.ReactElement) => void, route: string, asPath = route) {
  routerState.route = route;
  routerState.asPath = asPath;
  rerender(<Analytics />);
}

beforeEach(() => {
  window.localStorage.clear();
  Object.values(ga).forEach(fn => fn.mockReset());
  routerState.route = '/list';
  routerState.asPath = '/list';
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
    const { rerender } = render(<Analytics />);
    ga.trackPageView.mockClear();

    navigateTo(rerender, '/recipes/[id]', '/recipes/42');
    navigateTo(rerender, '/recipes', '/recipes');

    expect(ga.trackPageView.mock.calls).toEqual([
      ['/recipes/42', 'Recipe'],
      ['/recipes', 'Recipes'],
    ]);
  });

  // The query string is where a future `?q=<search terms>` would live, and
  // search terms are content.
  it('strips the query string from the reported path', () => {
    writeConsent('granted');
    const { rerender } = render(<Analytics />);
    ga.trackPageView.mockClear();

    navigateTo(rerender, '/recipes/[id]', '/recipes/42?stored=new');

    expect(ga.trackPageView).toHaveBeenCalledWith('/recipes/42', 'Recipe');
  });

  // The shallow router.replace that strips `?stored=new` from a freshly saved
  // Recipe is a route change to the same page, and must not be a second view.
  it('does not report the same path twice in a row', () => {
    writeConsent('granted');
    const { rerender } = render(<Analytics />);
    ga.trackPageView.mockClear();

    navigateTo(rerender, '/recipes/[id]', '/recipes/42?stored=new');
    expect(ga.trackPageView).toHaveBeenCalledTimes(1);

    navigateTo(rerender, '/recipes/[id]', '/recipes/42');

    expect(ga.trackPageView).toHaveBeenCalledTimes(1);
  });

  it('reports nothing for a route with no title rather than guessing one', () => {
    writeConsent('granted');
    const { rerender } = render(<Analytics />);
    ga.trackPageView.mockClear();

    navigateTo(rerender, '/some/route/nobody/mapped');

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
    const { rerender } = render(<Analytics />);
    expect(ga.stop).toHaveBeenCalledTimes(1);

    navigateTo(rerender, '/recipes');
    navigateTo(rerender, '/account');
    navigateTo(rerender, '/dave');

    expect(ga.stop).toHaveBeenCalledTimes(1);
  });

  // A declined visitor must not be reported at all, however much they navigate.
  it('reports no page views while consent is declined', () => {
    writeConsent('denied');
    const { rerender } = render(<Analytics />);

    navigateTo(rerender, '/recipes');
    navigateTo(rerender, '/account');

    expect(ga.trackPageView).not.toHaveBeenCalled();
  });

  // The spec is explicit that granting mid-visit "has to record the page they
  // are standing on, which no navigation is going to do for them". It used to be
  // an explicit call after start(); it now falls out of `consent` being in the
  // reporting effect's deps, which is easy to lose in a tidy-up.
  it('reports the current page when consent is granted mid-visit', () => {
    const { rerender } = render(<Analytics />);
    expect(ga.trackPageView).not.toHaveBeenCalled();

    writeConsent('granted');
    rerender(<Analytics />);

    expect(ga.start).toHaveBeenCalledTimes(1);
    expect(ga.trackPageView).toHaveBeenCalledWith('/list', 'Shopping list');
  });

  it('names the Account by its analytics id once it is known', () => {
    writeConsent('granted');
    mockUser.mockReturnValue({
      email: 'dev@localhost',
      accountId: 7,
      analyticsId: '4d1f0f8e-2a3b-4c5d-9e6f-70718293a4b5',
    });
    render(<Analytics />);

    // The random identifier, not the Account id sitting right next to it in the
    // same object - that is the whole point of the mapping table.
    expect(ga.setAccount).toHaveBeenCalledWith('4d1f0f8e-2a3b-4c5d-9e6f-70718293a4b5');
    expect(ga.setAccount).not.toHaveBeenCalledWith(7);
  });
});
