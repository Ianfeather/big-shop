import { logError } from './telemetry/log';

// Where server-side code finds the Go API.
//
// The browser and a Netlify function need different answers, and this is the
// only place that difference is written down.
//
// In production `NEXT_PUBLIC_API_HOST` is the *relative* path `/api/bigshop`,
// which Netlify rewrites to the Fly origin (netlify.toml). That is exactly
// right for the browser - same-origin, no CORS, the bearer token behaves as it
// always did - and meaningless inside a Node process, where a relative URL has
// no origin to be relative to. `fetch('/api/bigshop/account')` in a Netlify
// function does not go somewhere slow; it throws.
//
// So server-side callers read `API_HOST_INTERNAL`, an absolute URL pointing
// straight at the Fly machine. Going direct also skips a leg: those functions
// run in us-east-2, and the alternative is us-east-2 -> Netlify's edge ->
// Frankfurt. See specs/api-hosting-migration.md's Phase 4.
//
// **`API_HOST_INTERNAL` must never gain a `NEXT_PUBLIC_` prefix.** Next.js
// inlines every `NEXT_PUBLIC_*` variable into the client bundle at build time,
// which would publish the unproxied origin to every visitor and re-introduce
// the cross-origin call this design exists to avoid.
//
// The three server-side callers are lib/authenticate.ts, lib/dave/tools.ts and
// lib/recipe-import/known-names.ts. They differ in how they fail - authenticate
// fails closed, known-names degrades to empty lists - so this returns the host
// and lets each decide, rather than throwing on their behalf.
export function serverApiHost(): string | undefined {
  // The fallback is what keeps local development and e2e working with no extra
  // configuration: `scripts/dev-full.sh` sets an absolute NEXT_PUBLIC_API_HOST
  // (there is no proxy in front of `next dev`), so it is a perfectly good
  // server-side value there. In production it is relative, and setting
  // API_HOST_INTERNAL is what stops the fallback being reached.
  const host = process.env.API_HOST_INTERNAL || process.env.NEXT_PUBLIC_API_HOST;
  if (!host) return undefined;

  // Reject a relative value rather than returning it. This is the single
  // misconfiguration this whole file exists to guard against - API_HOST_INTERNAL
  // forgotten in the Netlify UI while NEXT_PUBLIC_API_HOST is the production
  // `/api/bigshop` - and without this check it is truthy, so every caller's
  // `if (!host)` guard passes and the failure surfaces much later as a `fetch`
  // that throws for no stated reason. Callers already know how to report a
  // missing host; this makes an unusable one take that same path.
  if (host.startsWith('/')) {
    logError(
      `API_HOST_INTERNAL is not set, and NEXT_PUBLIC_API_HOST ("${host}") is relative, ` +
        'so it cannot be used from a Node process. Set API_HOST_INTERNAL to the API origin.'
    );
    return undefined;
  }

  return host;
}

// Where server-side code reaches the API *through Netlify's edge*, for the
// handful of routes where that is faster than going direct.
//
// The opposite trade to serverApiHost above, and only worth making for the
// global catalogs. Those functions run in us-east-2 and the origin is in
// Frankfurt, so a direct call is a transatlantic round trip on every Recipe
// Import - the exact cost ADR-0006 moved the API to remove, reintroduced from
// the other side (follow-ups.md #51). Going through the site's own hostname
// instead means the request meets a Netlify PoP near the function, and
// `s-maxage` on /ingredients and /units means a hit is answered there rather
// than in Frankfurt.
//
// **A miss is slightly slower than going direct** - it is the same trip with a
// PoP in front of it - and that is the trade, made deliberately: a miss costs
// single-digit milliseconds while a hit saves the whole crossing, so the
// asymmetry pays for a low hit rate. The purge on Recipe write is what keeps
// the cached copy honest; see IngredientsCacheTag on the Go side.
//
// **Only for routes that answer `public`.** Sending an account-scoped route
// through here would put a personal response in front of a shared cache. The
// three catalogs are exempt from the API's auth gate precisely so that no
// Authorization header is involved (see GetRouter), which is also what makes
// the response cacheable at all - a shared CDN will not reliably store a
// response to an authenticated request.
//
// Returns undefined when there is no edge to use, which is the honest answer
// locally: `next dev` has no proxy in front of it, so scripts/dev-full.sh sets
// an absolute NEXT_PUBLIC_API_HOST and callers fall back to the direct host. A
// relative value is therefore the signal that Netlify *is* in front, and is
// what this reads rather than a separate flag that could disagree with it.
export function edgeApiHost(): string | undefined {
  const path = process.env.NEXT_PUBLIC_API_HOST;
  if (!path || !path.startsWith('/')) return undefined;

  // DEPLOY_URL first so a deploy preview reads its own edge rather than
  // production's - NEXT_PUBLIC_HOST is inlined at build time and points at
  // www.bigshop.life on every deploy, which is the same trap docs/deploy-
  // previews.md describes for Auth0 redirects. Both are Netlify's own runtime
  // variables; the last fallback is for a server-side render outside Netlify.
  const origin = process.env.DEPLOY_URL || process.env.URL || process.env.NEXT_PUBLIC_HOST;
  if (!origin) return undefined;

  return `${origin.replace(/\/$/, '')}${path}`;
}
