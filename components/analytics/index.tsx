import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import useConsent from '@hooks/use-consent';
import useUser from '@hooks/use-user';
import { setAccount, start, stop, trackPageView } from '../../lib/analytics/ga';
import { pageTitleFor } from '../../lib/analytics/page-titles';

// Turns the consent decision into GA being loaded or not, and reports page
// views while it is.
//
// Renders nothing. Mounted in pages/_app.tsx inside QueryClientProvider but
// *outside* InnerApp, because it has to work on the marketing homepage - which
// is both the page most likely to be measured and the one no authenticated
// wrapper renders.
//
// Nothing here decides policy. Whether analytics may run is entirely
// lib/consent.ts's answer, and this only acts on it.

export default function Analytics() {
  const [consent] = useConsent();
  const router = useRouter();
  const user = useUser();

  // The last path reported, so a re-render caused by anything else - a consent
  // change, the user query resolving - does not report the same page twice.
  const lastReported = useRef<string | null>(null);
  // The decision this component has already acted on, so start/stop run on a
  // change rather than on every render. Starts as null rather than 'unset' so a
  // visitor who arrives already decided is acted on once.
  const appliedConsent = useRef<string | null>(null);

  // The router itself, not the values off it, so the callback below can read
  // where we are *now* rather than where we were when it was last created.
  //
  // That distinction is the difference between reporting the right page and the
  // previous one. `routeChangeComplete` fires from Next, not from React, and
  // nothing guarantees a re-render has happened first - so a callback closed
  // over `router.asPath` from the last render can report the page being
  // navigated away from. Reading through the ref is always current.
  //
  // Kept in sync from an effect rather than assigned during render, which the
  // React compiler's refs rule forbids. In practice one assignment would do -
  // Next's pages router returns the same instance every time and mutates it in
  // place - but depending on that is exactly the kind of framework-internal
  // assumption that breaks quietly on an upgrade.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  // Stable across renders: both effects below depend on it, and a function
  // redeclared every render would re-register the route listener - and, worse,
  // re-run the start/stop effect - on every navigation.
  const reportCurrentPage = useCallback(() => {
    const { route, asPath } = routerRef.current;

    // The route template, so an unmapped page is caught by the lookup rather
    // than by whatever the resolved path happens to be.
    const title = pageTitleFor(route);
    if (!title) return;

    // asPath carries the resolved path and any query string. The path is fine -
    // Recipe ids are numeric, which ADR-0008 §1 treats as a pseudonymous
    // identifier - but the query string is not: `?stored=new` is harmless and a
    // future `?q=<search terms>` would not be, and search terms are content.
    const path = asPath.split('?')[0].split('#')[0];
    if (lastReported.current === path) return;

    lastReported.current = path;
    trackPageView(path, title);
  }, []);

  // Start and stop on the decision *changing*, not on every render that
  // happens to see it.
  //
  // The transition guard survives even now that `reportCurrentPage` is stable:
  // an effect keyed on a value re-runs whenever React re-renders with a new
  // dependency identity, and a declined visitor running the whole withdrawal
  // path - two cookie sweeps and a timer - more than once is waste at best.
  //
  // `unset` deliberately does nothing at all: a visitor who has not answered
  // has nothing to clear, and only an explicit `denied` has anything to clean
  // up after.
  useEffect(() => {
    const previous = appliedConsent.current;
    if (previous === consent) return;
    appliedConsent.current = consent;

    if (consent === 'granted') {
      start();
      // Reported here as well as on route change: granting consent mid-visit
      // has to record the page they are standing on, which no navigation is
      // going to do for them.
      reportCurrentPage();
    } else if (consent === 'denied') {
      stop();
      lastReported.current = null;
    }
  }, [consent, reportCurrentPage]);

  // Page views on client-side navigation.
  //
  // routeChangeComplete rather than the initial render, because every route but
  // `/` is a client-rendered SPA: the tag's own single pageload measures a whole
  // session as one view, which is why `send_page_view` is false in ga.ts.
  useEffect(() => {
    const onRouteChange = () => reportCurrentPage();
    router.events.on('routeChangeComplete', onRouteChange);
    return () => router.events.off('routeChangeComplete', onRouteChange);
  }, [router.events, reportCurrentPage]);

  // The Account this browser is acting for, once it is known.
  //
  // Set separately from the page view rather than as a parameter on it, because
  // it is a *user property* - it should attach to everything this session sends,
  // including events that fire before or after any particular navigation.
  // `consent` is in the deps although the body does not read it, and that is
  // deliberate rather than an oversight: setAccount is a no-op until GA is
  // collecting, so granting consent *after* the user has loaded has to re-run
  // this or the Account is never named for the rest of the visit. Removing it
  // is the tidy-up that quietly loses the user property.
  useEffect(() => {
    setAccount(user?.accountId);
  }, [user?.accountId, consent]);


  return null;
}
