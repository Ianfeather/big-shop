// Did this page load arrive from Auth0's hosted login, rather than from someone
// opening the app normally?
//
// One caller: hooks/use-account-setup.ts, which uses it to decide whether to
// hold the first render while POST /user creates the account. A login is the
// only arrival where the account may not exist yet, so it is the only arrival
// worth waiting on - every other launch renders immediately. The reasoning is
// written out there.
//
// This used to serve pages/index.tsx, which was where `redirect_uri` pointed:
// the homepage had to notice a login and forward the user to /list, because
// landing back on the pitch you just left reads as a login that did nothing.
// The callback now goes to /list directly (lib/app-origin.ts), so there is no
// forwarding left to do - but the *question* survives the move intact, because
// the ordering problem it answers moved to /list along with the callback.
//
// Auth0 marks the arrival with `?code=&state=` on the callback URL. The catch
// is that they do not survive: Auth0Provider processes the callback in a mount
// effect and then rewrites the URL with history.replaceState, so anything
// reading `location.search` from inside a component is racing it.
//
// Hence module scope. This is evaluated once, when the client bundle is first
// evaluated - before any component renders, and well before that effect runs.
// It is a constant for the life of the page, which is exactly right: whether
// this load began at Auth0 is a fact about the load, not a piece of state.
//
// Server-side it is false. Nothing reads it during SSR, and it is only ever
// consulted from an effect or from a render that has already hydrated.
export const arrivedFromLogin = (() => {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.has('code') && params.has('state');
})();
