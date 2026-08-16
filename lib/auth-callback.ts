// Did this page load land here from Auth0's hosted login, rather than from
// someone typing the bare domain?
//
// The homepage no longer redirects a logged-in visitor to /list - it renders
// for everyone, with the header saying where their list is (follow-ups.md #58).
// One arrival still has to be sent onward: clicking "Log in" returns you to
// `redirect_uri`, which hooks/use-login.ts sets to the app origin, i.e. this
// same page. Landing back on the pitch you just left, with nothing but a
// changed button to show for it, reads as a login that did nothing.
//
// Auth0 marks that arrival with `?code=&state=` on the callback URL. The catch
// is that they do not survive: Auth0Provider processes the callback in a mount
// effect and then rewrites the URL with history.replaceState, so anything
// reading `location.search` from inside a component is racing it.
//
// Hence module scope. This is evaluated once, when the client bundle is first
// evaluated - before any component renders, and well before that effect runs.
// It is a constant for the life of the page, which is exactly right: whether
// this load began at Auth0 is a fact about the load, not a piece of state.
//
// Server-side it is false. Nothing reads it during SSR (the static homepage is
// built once at deploy time, when there is no callback to observe), and it is
// only ever consulted from an effect.
export const arrivedFromLogin = (() => {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.has('code') && params.has('state');
})();
