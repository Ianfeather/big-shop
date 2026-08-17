// Google Analytics 4, loaded only for someone who has said yes.
//
// The fourth recipient of anything in this system, after Grafana (twice) and
// OpenAI, and the only one gated on consent - see specs/analytics-and-consent.md
// and ADR-0008 §1, which this extends. What Google gets is deliberately narrow:
// which pages were visited, a short fixed list of actions, and an account
// number. Not who you are, and not what you cook.
//
// Shaped like lib/telemetry/faro.ts on purpose - the presence of the id is the
// switch, and nothing in here may throw - but with the opposite default. Faro
// starts as early as it can and runs for everyone; this starts as late as it
// can and runs for almost nobody.

// The measurement id. Its presence is the entire on/off switch, so a build
// cannot be "on but misconfigured", and a deploy preview or a laptop gets no
// tag and makes no requests. Same mechanism as NEXT_PUBLIC_FARO_COLLECTOR_URL.
function measurementId(): string | undefined {
  return process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
}

export function enabled(): boolean {
  return !!measurementId();
}

// gtag pushes to this array; the tag reads it back when it loads. Declaring it
// ourselves means every call below is safe to make before the script arrives -
// which matters, because `consent` has to be queued *ahead* of it.
type GtagArgs = [command: string, ...rest: unknown[]];

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: GtagArgs) => void;
  }
}

// The rest parameter exists for *typing* only - the body deliberately pushes
// `arguments`, not `args`. Tidying this into an arrow function, or into
// `push(args)`, compiles cleanly and silently breaks every hit.
function gtag(...args: GtagArgs): void {
  void args;
  window.dataLayer = window.dataLayer || [];
  // The literal `arguments` object, not an array - gtag.js is specified this
  // way and reads `arguments.length`. Pushing an array here silently produces
  // hits the tag ignores, which is the kind of bug that looks like "analytics
  // just isn't working".
  window.dataLayer.push(arguments);
}

// **Two flags, because they are two facts and conflating them breaks
// withdrawal in both directions.**
//
// `loaded` is "gtag.js is in the page", which is irreversible - there is no
// unload. `collecting` is "we are currently permitted to send", which flips
// every time the visitor changes their mind.
//
// A single flag standing for both was the first version, and it was wrong twice
// over. Reporting gated on "loaded" meant that after a withdrawal the router's
// page-view handler kept sending hits to a tag that was still in the page -
// cookieless, but still requests to Google, which is exactly what
// "declining should cost zero requests" rules out. And `start()` returning
// early on the same flag meant re-granting in the same visit never re-sent the
// consent update, so someone who withdrew and changed their mind back was
// silently left uncollected until they reloaded.
let loaded = false;
let collecting = false;

// Starts GA. Idempotent, and does nothing at all without consent.
//
// **The tag is not loaded until this is called.** That is a deliberate
// departure from Consent Mode v2's intended design, which is to load gtag.js
// unconditionally and let the consent signal gate storage, sending cookieless
// pings meanwhile. Recording the reasoning because "the tag is supposed to load
// on every page" is a correct reading of Google's own documentation and a
// reasonable person will try to apply it:
//
//   - those cookieless pings exist to feed conversion modelling in an ads
//     context, and Big Shop runs no ads and has no ads account, so there is
//     nothing on the other side to model;
//   - a ping still carries the visitor's IP to Google, which is a transfer
//     they have not agreed to;
//   - declining should cost nothing. Not fewer bytes - none.
//
// Consent Mode is still implemented below, because it is what handles the case
// gating alone cannot: withdrawal, when the tag is already in the page.
export function start(): void {
  if (typeof window === 'undefined') return;
  if (!enabled()) return;

  try {
    // Always, even when the tag is already in the page: this is what makes
    // re-granting after a withdrawal work within one visit.
    collecting = true;

    if (loaded) {
      gtag('consent', 'update', { analytics_storage: 'granted' });
      return;
    }

    // Set before the DOM work so a second call cannot append a second script
    // while the first is in flight; reset in the catch, so a genuine failure
    // leaves this retryable rather than permanently "loaded" with no tag - a
    // state in which every later call would queue into a dataLayer nothing will
    // ever drain.
    loaded = true;

    // Defaults first, and denied, before the tag is anywhere near the page.
    // Ordering is not cosmetic: gtag.js applies whatever consent state it finds
    // in the queue when it initialises, so a `default` pushed afterwards would
    // arrive too late to have gated anything.
    //
    // **The three ad signals stay denied forever.** Big Shop runs no ads. They
    // are named explicitly rather than omitted so that the intent is legible -
    // an unset signal and a denied one behave the same today, but "we never
    // asked for this" is the thing worth being able to read off the code.
    // Granting them "for completeness" when the analytics one flips is the
    // obvious drift and this comment is the guard against it.
    gtag('consent', 'default', {
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      analytics_storage: 'denied',
    });
    gtag('consent', 'update', { analytics_storage: 'granted' });

    gtag('js', new Date());
    gtag('config', measurementId() as string, {
      // Page views are fired by hand - see trackPageView. Every route but `/`
      // is a client-rendered SPA, so the tag's own single pageload would count
      // a whole session as one view.
      send_page_view: false,
    });

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId() as string)}`;
    document.head.appendChild(script);
  } catch {
    // Swallowed, like every path in faro.ts. Analytics failing must never be
    // the reason a page does not work.
    //
    // Both flags go back down: with no tag there is nothing to collect into,
    // and leaving `collecting` true would pile hits into a dataLayer that is
    // never read.
    loaded = false;
    collecting = false;
  }
}

// The cookies to remove, by prefix. `_ga` is the GA4 client id and
// `_ga_<STREAM>` the session; `_gid`/`_gat` are Universal Analytics rather than
// GA4, kept because a property that has ever run UA may still have them on the
// device and leaving them would be the same failure in an older costume. There
// is no API for any of this, so withdrawal deletes them by hand.
const GA_COOKIE_PREFIXES = ['_ga', '_gid', '_gat'];

// Stops collection and removes what GA has already stored.
//
// **Both halves are required.** Signalling denial while leaving `_ga` on the
// device is the common half-implementation: the identifier that ties this
// browser to its history survives, ready to be reused the moment anyone
// re-grants. Withdrawal has to mean the thing it says.
export function stop(): void {
  if (typeof window === 'undefined') return;

  try {
    collecting = false;

    if (loaded) {
      gtag('consent', 'update', { analytics_storage: 'denied' });
    }

    clearGaCookies();

    // **Swept again shortly after, and this is not belt-and-braces.** An
    // already-loaded gtag.js can write `_ga` asynchronously, so a withdrawal
    // that deletes once can lose the race to a write the tag had already
    // started - leaving the identifier in place while the UI, the consent
    // signal and the stored decision all say it is gone. Observed happening in
    // a browser, not theorised: one run cleared the cookies and the next did
    // not, with nothing different in the code.
    //
    // A second sweep a second later is enough, because the consent update above
    // has by then been processed and the tag has stopped writing. It is
    // deliberately not a poll: if something is still writing `_ga` a second
    // after being told not to, another five sweeps will not fix it and the
    // problem is not this function's to solve.
    window.setTimeout(clearGaCookies, 1000);
  } catch {
    // As above.
  }
}

// Expires every GA cookie at every domain and path it might have been written
// to.
//
// The domain variants matter: a cookie set on `.bigshop.life` is not removed by
// expiring one on `www.bigshop.life`, and getting that wrong leaves the
// identifier in place while appearing to have cleared it.
function clearGaCookies(): void {
  try {
    const hostname = window.location.hostname;
    const domains: (string | undefined)[] = [undefined, hostname, `.${hostname}`];
    const parts = hostname.split('.');
    if (parts.length > 2) domains.push(`.${parts.slice(-2).join('.')}`);

    document.cookie
      .split(';')
      .map(cookie => cookie.split('=')[0].trim())
      .filter(name => GA_COOKIE_PREFIXES.some(prefix => name.startsWith(prefix)))
      .forEach(name => {
        domains.forEach(domain => {
          document.cookie =
            `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/` +
            (domain ? `; domain=${domain}` : '');
        });
      });
  } catch {
    // As above.
  }
}

// Records a page view.
//
// `path` is the resolved path and may carry a numeric Recipe id, which ADR-0008
// §1 classes as a pseudonymous identifier rather than content. `title` must
// come from the caller's static lookup - see lib/analytics/page-titles.ts for
// why it is never read from document.title.
export function trackPageView(path: string, title: string): void {
  if (!collecting) return;

  try {
    gtag('event', 'page_view', {
      page_path: path,
      page_location: window.location.origin + path,
      page_title: title,
    });
  } catch {
    // As above.
  }
}

// Names the Account this browser is acting for.
//
// **A user property, and never `user_id`.** The questions this exists to answer
// are about Accounts - "how many Accounts have ever used Dave" - and a user
// property answers them without asserting a cross-device person identity, which
// is what `user_id` is for and what GA would then try to stitch across devices.
//
// **The Auth0 subject is never sent to Google.** It goes to Faro and to the
// API's spans and stops there. ADR-0008 §1 permits pseudonymous identifiers to
// Grafana; the rule for this recipient is tighter, and the amendment there says
// so.
export function setAccount(accountId: number | undefined): void {
  if (!collecting || accountId === undefined) return;

  try {
    gtag('set', 'user_properties', { account_id: String(accountId) });
  } catch {
    // As above.
  }
}

