// Where to send someone after they log in, when they did not start at the front
// door.
//
// **The hole this fills.** Every route but `/`, `/privacy`, `/support` and
// `/error` is gated in `pages/_app.tsx`, which bounced an unauthenticated
// visitor with `router.push('/')` and discarded the route it bounced. Combined
// with `hooks/use-login.ts` pinning `redirect_uri` to the app origin, a
// logged-out click on any deep link landed on the marketing homepage with no
// login prompt and nothing to say why - and logging in from there went to
// `/list`. The Day 8 onboarding email's Featured Recipe links are the product's
// first deep links, so this is the first time it has mattered.
//
// **Why sessionStorage and not Auth0's `appState`.** `appState` is the SDK's
// own answer and would be the obvious choice, but it is delivered through
// `Auth0Provider`'s `onRedirectCallback`, and this app already has a
// post-login redirect: `pages/index.tsx` watches `arrivedFromLogin` and sends
// an authenticated arrival to `/list` after `POST /user` has resolved their
// onboarding state. Adding `onRedirectCallback` would put two mechanisms on the
// same moment, racing over the same navigation - and `lib/auth-callback.ts`
// already documents how delicate that moment is, since Auth0 rewrites the URL
// with `history.replaceState` in a mount effect before any component renders.
// Storing the destination instead lets the existing redirect keep sole
// ownership and simply choose a better target.
//
// The value survives exactly as long as it needs to: same tab, same origin,
// across the round trip to Auth0 and back. It is consumed on read, so a login
// later in the same tab cannot be hijacked by a stale entry.

const KEY = 'bigshop:returnTo';

// Is this a path we are willing to send a browser to after login?
//
// **This is a security boundary, not tidiness.** The value reaches us from the
// address bar, so anything that can express an absolute URL turns the login
// flow into an open redirect - a link that sends someone through *our* Auth0
// and drops them somewhere else, which is exactly the shape a credible phishing
// link wants. So this validates a *path*, and deliberately does not go anywhere
// near `new URL()`: parsing invites judging a host, and the only safe answer
// here is to refuse to have one at all.
//
// Rejected, and why each matters:
//   - `https://evil.example` and any other scheme-bearing value - the plain case.
//   - `//evil.example` - protocol-relative, and the one most often missed: it
//     passes a naive "starts with /" test and is a fully qualified URL.
//   - `\\evil.example` and `/\evil.example` - browsers have historically
//     normalised backslashes to forward slashes, so these reach the same place.
//   - anything not starting with a single `/` - relative paths resolve against
//     wherever the reader happens to be, which is not a destination we chose.
export function isSafeReturnTo(path: unknown): path is string {
  if (typeof path !== 'string' || path === '') return false;
  if (!path.startsWith('/')) return false;
  // Both slash kinds, so `/\` and `//` are caught by one rule.
  if (path[1] === '/' || path[1] === '\\') return false;
  if (path.includes('\\')) return false;
  return true;
}

// Remember where someone was trying to go. Refuses anything isSafeReturnTo
// refuses, so a bad value is never stored in the first place - the check on the
// way out stays as well, because a value can also be written by an older build
// still in the same tab.
export function rememberReturnTo(path: string): void {
  if (typeof window === 'undefined') return;
  if (!isSafeReturnTo(path)) return;
  // `/` is where the bounce lands anyway, and storing it would make an ordinary
  // login look like a deep link that had been interrupted.
  if (path === '/') return;
  try {
    window.sessionStorage.setItem(KEY, path);
  } catch {
    // Private browsing modes and storage quotas both throw here. Losing the
    // destination sends someone to /list instead, which is a worse landing and
    // not a broken one - never a reason to fail a login.
  }
}

// Take the remembered destination, if there is a usable one, and forget it.
export function consumeReturnTo(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const path = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    return isSafeReturnTo(path) ? path : null;
  } catch {
    return null;
  }
}
