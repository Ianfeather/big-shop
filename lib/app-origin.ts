// The origin this build is actually being served from.
//
// `NEXT_PUBLIC_HOST` used to be the answer, and it is a *build-time* constant:
// Next.js inlines every `NEXT_PUBLIC_*` value into the bundle, and
// `.env.production` pins it to https://www.bigshop.life. So every
// production-mode build - Netlify deploy previews included - told Auth0 to send
// the user to the live site, and a preview could not be exercised past the
// login screen at all (follow-ups.md #48). Reading the origin from the browser
// makes it follow the deploy instead, with no per-deploy configuration.
//
// Only the three call sites that need an *absolute* URL use this: Auth0's
// `redirect_uri` (pages/_app.tsx, hooks/use-login.ts) and its logout
// `returnTo` (components/identity/logout). Calls to this app's own Next.js API
// routes want a relative path rather than this - see the note there.
//
// The `NEXT_PUBLIC_HOST` fallback is for server rendering, where there is no
// window. Every caller uses the result in a browser-only code path (a login
// redirect, a logout), so the fallback keeps SSR from throwing rather than
// being the value anyone acts on.
export function appOrigin(): string | undefined {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return process.env.NEXT_PUBLIC_HOST;
}
