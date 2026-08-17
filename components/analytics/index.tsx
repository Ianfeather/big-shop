import { useEffect, useRef } from 'react';
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

  // The last path reported, so a re-render caused by anything else - the user
  // query resolving, a shallow route change that only strips a query string -
  // does not report the same page twice.
  const lastReported = useRef<string | null>(null);
  // The decision this component has already acted on, so start/stop run on a
  // change rather than on every render. Starts as null rather than 'unset' so a
  // visitor who arrives already decided is acted on once.
  const appliedConsent = useRef<string | null>(null);

  // Start and stop on the decision *changing*, not on every render that happens
  // to see it. Declared before the reporting effect so that granting consent and
  // reporting the page it was granted on happen in that order.
  //
  // `unset` deliberately does nothing at all: a visitor who has not answered has
  // nothing to clear, and only an explicit `denied` has anything to clean up
  // after.
  useEffect(() => {
    if (appliedConsent.current === consent) return;
    appliedConsent.current = consent;

    if (consent === 'granted') {
      start();
    } else if (consent === 'denied') {
      stop();
      lastReported.current = null;
    }
  }, [consent]);

  // Page views, fired from an effect on the router's own state rather than from
  // a `routeChangeComplete` listener.
  //
  // **That choice is the fix for a bug, not a style preference**, and the
  // spec's own wording ("fire on `routeChangeComplete`") describes the version
  // that did not work.
  //
  // What was observed, in a browser: with a `router.events` subscription, every
  // navigation reported the *previous* page. Saving a new Recipe recorded a
  // view for the form it had just left, and the Recipe's own view only appeared
  // when the next navigation happened. Reading the router through a ref rather
  // than off the closure did not change it.
  //
  // **The precise reason inside Next was not pinned down**, and this comment
  // deliberately does not guess at one - an earlier draft asserted a mechanism
  // that turned out not to describe the code it was replacing, which is worse
  // than saying nothing. What is certain is the shape: the handler ran at a
  // moment when the values it needed were not yet the new ones.
  //
  // An effect keyed on those values cannot have that problem whatever the cause
  // is, because it runs *because* React re-rendered with them. `route` and
  // `asPath` are necessarily the ones being reported. Every navigation still
  // produces exactly one view, which is what the spec actually asks for -
  // `send_page_view: false` in ga.ts means the tag sends none of its own.
  useEffect(() => {
    if (consent !== 'granted') return;

    // The route template, so an unmapped page is caught by the lookup rather
    // than by whatever the resolved path happens to be.
    const title = pageTitleFor(router.route);
    if (!title) return;

    // asPath carries the resolved path and any query string. The path is fine -
    // Recipe ids are numeric, which ADR-0008 §1 treats as a pseudonymous
    // identifier - but the query string is not: `?stored=new` is harmless and a
    // future `?q=<search terms>` would not be, and search terms are content.
    //
    // Stripping it also makes the dedupe below do the right thing on the shallow
    // `router.replace` that removes `?stored=new` from a freshly saved Recipe:
    // same page, one view.
    const path = router.asPath.split('?')[0].split('#')[0];
    if (lastReported.current === path) return;

    lastReported.current = path;
    trackPageView(path, title);
  }, [consent, router.route, router.asPath]);

  // The Account this browser is acting for, once it is known.
  //
  // Set separately from the page view rather than as a parameter on it, because
  // it is a *user property* - it should attach to everything this session sends,
  // including events that fire between navigations.
  //
  // `consent` is in the deps although the body does not read it, and that is
  // deliberate rather than an oversight: setAccount is a no-op until GA is
  // collecting, so granting consent *after* the user has loaded has to re-run
  // this or the Account is never named for the rest of the visit. Removing it is
  // the tidy-up that quietly loses the user property.
  useEffect(() => {
    setAccount(user?.accountId);
  }, [user?.accountId, consent]);

  return null;
}
