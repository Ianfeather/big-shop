// Grafana Faro: browser errors, console warnings and web vitals.
//
// The third and last runtime in ADR-0007's tenancy model - `bigshop-api` on
// Fly, `bigshop-web` in the Netlify functions, and this. It replaces nothing,
// because there was nothing: the spec's survey of the current state records "15
// `console.*` calls in the frontend, and no client error reporting of any kind",
// so until now a broken page was something you found out about by being told.
//
// **This deliberately does not do browser tracing**, and that is the single
// most likely thing here to be "fixed" by someone following Grafana's own
// onboarding snippet, which includes it by default. See below.

import { InternalLoggerLevel, getWebInstrumentations, initializeFaro } from '@grafana/faro-web-sdk';
import type { APIEvent, ExceptionEvent, Faro, TransportItem } from '@grafana/faro-web-sdk';

// service.name for this runtime. The third of the three names ADR-0007 lists,
// and the reason a single `service.name =~ "bigshop-.*"` query reaches every
// part of this system.
//
// It is also the key the source-map bundle id hangs off: `faro-cli
// inject-bundle-id --app-name` writes `globalThis["__faroBundleId_<appName>"]`
// into the built JavaScript, and @grafana/faro-core reads back the same key. The
// two must agree exactly or stack traces stay minified, so this constant is
// imported by scripts/upload-sourcemaps.sh's caller rather than retyped.
export const APP_NAME = 'bigshop-browser';

// Whether Faro will actually start. Mirrors the server side's `enabled()`: the
// presence of the endpoint is the switch, so there is no way to be "on" and
// misconfigured, and a build without it gets no SDK and no network calls.
export function enabled(): boolean {
  return !!process.env.NEXT_PUBLIC_FARO_COLLECTOR_URL;
}

let faro: Faro | undefined;

// The deployed sha. Doubles as the source map bundle id, so the two can never
// disagree - scripts/upload-sourcemaps.sh derives its `--bundle-id` from the
// same Netlify variable this is built from.
function version(): string {
  return process.env.NEXT_PUBLIC_SERVICE_VERSION || 'dev';
}

// Whether this build is the real thing, as opposed to a deploy preview, a
// branch deploy or a laptop. Read from the same value that labels the telemetry,
// so the two can never disagree about which is which.
function isProduction(): boolean {
  return process.env.NEXT_PUBLIC_DEPLOY_ENV === 'production';
}

// Starts Faro. Safe to call more than once; only the first call does anything.
//
// **Never throws.** ADR-0007: the browser path is genuinely fire-and-forget and
// Faro cannot affect page behaviour. A telemetry failure must not be the reason
// a cook cannot see their shopping list, so every path out of here is a return.
export function setupFaro(): void {
  // Guarded rather than assumed: this module is imported from _app.tsx, which
  // Next.js also renders on the server, where `window` does not exist and the
  // SDK's instrumentations have nothing to attach to.
  if (typeof window === 'undefined') return;
  if (faro || !enabled()) return;

  try {
    // Tells Faro which build this is, so a minified stack frame can be matched
    // to the source maps uploaded for the same build.
    //
    // **Set here rather than by rewriting the built files, and that is the whole
    // point.** Grafana's tooling injects this with `faro-cli inject-bundle-id`,
    // which prepends a 263-character IIFE to each chunk *after* the bundler has
    // written its source maps. Turbopack emits one enormous line, so those 263
    // characters shift every column on line 1 - and the map then resolves each
    // frame to whatever happened to sit 263 characters earlier. The result is
    // not a broken stack trace, which would be obvious. It is a *confident and
    // wrong* one: this app's smoke test, thrown from pages/index.tsx, resolved
    // to hooks/use-login.ts. Worse than staying minified, because it looks like
    // it worked.
    //
    // Assigning the global from application code adds no bytes to any built
    // file, so the maps stay byte-accurate. @grafana/faro-core's getBundleId()
    // reads exactly this key and cannot tell the difference.
    //
    // It has to be the global rather than `app.bundleId` in the config below:
    // registerInitialMetas does `{ ...config.app, ...initial.app }`, and
    // `initial.app.bundleId` comes from this global - so it spreads last and
    // overwrites anything passed in config, with `undefined` if unset.
    (globalThis as Record<string, unknown>)[`__faroBundleId_${APP_NAME}`] = version();

    faro = initializeFaro({
      url: process.env.NEXT_PUBLIC_FARO_COLLECTOR_URL,
      app: {
        name: APP_NAME,
        // The deployed sha, so a spike in errors can be read against "which
        // build is this?". Bridged into the client bundle by next.config.js,
        // because Netlify's COMMIT_REF is a server-side variable and Next only
        // inlines NEXT_PUBLIC_* ones.
        version: version(),
        // Keeps a deploy preview's errors out of production's numbers, exactly
        // as `deployment.environment.name` does on the other two runtimes.
        environment: process.env.NEXT_PUBLIC_DEPLOY_ENV || 'development',
      },

      // **No `TracingInstrumentation`, and no `@grafana/faro-web-tracing` in
      // package.json at all.**
      //
      // Grafana's onboarding snippet includes it, and the spec rules it out in
      // terms that are worth quoting rather than paraphrasing: "No browser spans
      // and no propagation from the client - the backend hop is where the
      // causality lives; browser tracing is where the time goes." It sits under
      // the spec's "grilled - do not re-litigate without a load-bearing reason"
      // heading, so adding it back is a decision to be argued for, not a gap to
      // be filled.
      //
      // Two practical consequences, so nobody has to rediscover them. Browser
      // spans would need `propagateTraceHeaderCorsUrls` pointing at the API,
      // which means the browser dictating trace ids to the backend - and it is
      // the one participant in this system that is entirely untrusted. And the
      // tracing package is by some distance the largest part of Faro's bundle,
      // paid for by every visitor on every page load.
      //
      // Console capture is left at its default, which is on for `warn` and
      // `error` and off for `log`, `debug` and `trace`. That is the right shape
      // here: the five `console.error` call sites in this frontend are all
      // reporting failures, and `console.log` noise is not worth shipping.
      instrumentations: getWebInstrumentations(),

      // Faro writes its own failures to the console, and a collector it cannot
      // reach means one `console.error` per flush, forever, in every visitor's
      // devtools. That is the browser twin of the log flood ADR-0007 tells us to
      // silence on the server ("the SDK's default `ErrorHandler` is replaced so
      // it does not spam logs"), and the same argument applies: a telemetry
      // backend being down should be invisible to the person using the app.
      //
      // **Off in production only, deliberately.** Silencing it everywhere was
      // the first instinct and would have been a mistake: this project's Faro
      // app initially rejected every request on CORS, and that console error is
      // exactly how it was found. Keeping the channel open outside production
      // preserves the diagnosis; closing it in production keeps a stranger's
      // console clean. Faro logs through an unpatched console, so none of this
      // feeds back into its own console capture.
      internalLoggerLevel: isProduction()
        ? InternalLoggerLevel.OFF
        : InternalLoggerLevel.ERROR,

      // Content, not identifiers, is what ADR-0008 §1 excludes - and a browser
      // is the easiest place in this system to send content by accident, since
      // a caught error's message is often a response body. This is the one hook
      // that sees every payload before it leaves, so it is where that rule is
      // enforced rather than hoped for.
      beforeSend: scrub,
    });
  } catch {
    // Swallowed on purpose. Whatever went wrong, the page still has to work.
  }
}

// Associates the session with the signed-in user.
//
// ADR-0007's case for Faro over Sentry is that "frontend sessions correlate
// with backend traces in one view", and this is the join: the Auth0 subject
// here is the same value the Go API puts on its spans as `user.sub`.
//
// ADR-0008 §1 permits it explicitly - "Spans and log lines carry `account.id`,
// the Auth0 subject" - because it is pseudonymous. Nothing else about the user
// is set: no email (named in §1 as excluded by rule), no name, no picture,
// though the Auth0 profile has all three sitting right there.
export function identifyUser(sub: string | undefined): void {
  if (!faro || !sub) return;
  try {
    faro.api.setUser({ id: sub });
  } catch {
    // As above.
  }
}

// Names the page a session is on, so errors group by route rather than arriving
// as one undifferentiated stream.
//
// The route *template* - `/recipes/[id]` - never the resolved path. The path
// carries a recipe id, and on a browser view name that would be both content
// and an unbounded label, which is the pair of mistakes ADR-0008 §1 and §2
// exist to prevent. It is the same reasoning that made `http.route` a hard-coded
// template in lib/telemetry/api-route.ts.
export function setView(route: string): void {
  if (!faro) return;
  try {
    faro.api.setView({ name: route });
  } catch {
    // As above.
  }
}

// Drops anything carrying content, and lets everything else through unchanged.
//
// Exported for its test rather than for any caller - the same reason
// metrics.ts exports resetInstruments. A rule this easy to regress silently is
// worth asserting on.
//
// Faro's own payloads - web vitals, session events, navigation timings - are
// numbers and route names and pass through untouched. What needs care is the
// two shapes that quote arbitrary strings: an error message, and the arguments
// to a captured `console.warn`/`console.error`.
//
// Deliberately conservative in one specific way, matching `safeError` on the
// server: a `SyntaxError` from `JSON.parse` embeds a slice of what it was
// parsing, and in this app that is an API response - recipe names, ingredient
// text. The type is worth keeping; the message is not.
// The message is replaced and **the stack trace is kept**. That asymmetry is the
// point: the frames carry function names and file positions, which is precisely
// what the source-map upload in scripts/upload-sourcemaps.sh exists to make
// readable, while the message is the only part quoting the document. Throwing
// the stack away to scrub the message would discard the evidence and keep the
// cost.
export function scrub(item: TransportItem<APIEvent>): TransportItem<APIEvent> | null {
  try {
    const payload = item.payload as Partial<ExceptionEvent>;

    if (payload?.type === 'SyntaxError') {
      payload.value = 'SyntaxError parsing a response body (message withheld - ADR-0008 §1)';
    }

    return item;
  } catch {
    // A hook that throws would take the payload with it. Anything unexpected
    // means "send it as it was", which is the same choice the rest of this file
    // makes: telemetry must not be the thing that breaks.
    return item;
  }
}
