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
