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

// Where Auth0 sends someone once they have logged in.
//
// `/list` rather than the origin root, and that is the whole of "the installed
// app opens on the list". `start_url` in public/manifest.json already launches
// the PWA there, but a launch with no live session is bounced to `/` by
// pages/_app.tsx's InnerApp - so before this, finishing a login returned you to
// the marketing homepage, inside a standalone window with no address bar, and
// the homepage had to forward you on. It only sometimes did (see the note in
// pages/index.tsx about what `onboarded` used to gate), and even when it did it
// cost a second navigation to show a page nobody had asked for.
//
// Landing here directly means the callback and the manifest agree, so a first
// login and every later launch end up in the same place by the same route.
//
// `/list` must be registered in the Auth0 tenant's Allowed Callback URLs for
// every origin this resolves to - see docs/deploy-previews.md, which is the
// same requirement the bare origin already had.
export function loginRedirectUri(): string | undefined {
  const origin = appOrigin();
  return origin && `${origin}/list`;
}
