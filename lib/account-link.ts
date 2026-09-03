// The browser's half of account linking recovery — see
// `specs/account-linking-recovery.md` and
// `netlify-functions/recipes/internal/pkg/service/link.go`.
//
// Somebody whose second sign-in handed over a different verified address gets a
// brand new, empty Account and no error anywhere, because at the level of the
// data there is nothing wrong. This is what lets them prove they own the other
// account the only way that actually proves it: by signing into it.
//
// **The nonce is the whole reason this file exists rather than the flow being
// two fetch calls at the call sites.** Re-authenticating proves the person owns
// the account they are claiming; it never proves that whoever *started* the
// link is whoever *finished* it. Without a browser binding, an attacker starts a
// link as themselves, sends the return URL to a victim, and the victim — asked
// to sign in, which looks entirely normal — signs in as themselves and returns
// holding the attacker's token, bonding the attacker's login to their account.
// A value held in this origin's own storage and required at completion makes the
// grant non-transferable: a URL pasted into another browser has nothing to match
// and is inert. It is the ordinary CSRF state defence, applied to the right
// thing.

// localStorage, not sessionStorage, and the difference is which journeys
// survive.
//
// sessionStorage would be enough for the web today — it lives as long as the
// tab, which covers the round trip to Auth0 and back, and `lib/return-to.ts`
// uses it for exactly that. It is not enough for the two journeys this has to
// keep working. The installed PWA can be resumed in what the browser treats as
// a fresh session, and `specs/native-app-wrapper.md` §4 hands authentication to
// `ASWebAuthenticationSession` / Custom Tabs and **deep-links back into the
// app** — so the app writes this in its own origin, delegates only the
// authentication, and regains control in the same context with its storage
// intact.
//
// And the failure direction is the safe one. If some untested platform loses
// this anyway, the link does not complete: the person retries, or does it on the
// web. A usability cost, not a hole.
const KEY = 'bigshop:pendingLink';

// What survives the trip to Auth0 and back.
export interface PendingLink {
  // The secret that binds the completion to this browser. Never sent anywhere
  // but `POST /link/complete`.
  nonce: string;
  // What `POST /link/start` handed back. Useless on its own.
  token: string;
  // The human name of the sign-in method being linked — "Apple", "Google" — or
  // "" when the server did not recognise the provider.
  //
  // Kept here rather than fetched on the confirmation page because by then the
  // browser has re-authenticated as somebody *else*, so it is the only thing
  // that still knows which sign-in this is about. The confirmation asks the
  // person to make a security decision, and it cannot do that without naming
  // the thing being granted access.
  provider: string;
}

// Somewhere between "long enough that nobody guesses it" and "short enough to
// sit in a request body". 32 bytes, hex, matching the token the server mints.
const NONCE_BYTES = 32;

// A fresh nonce.
//
// `crypto.getRandomValues`, never `Math.random()`. This is the value that stops
// a link started by one person being finished by another, so it has to be
// unguessable rather than merely unlikely — and `Math.random()` is neither
// seeded from an unpredictable source nor specified to be unpredictable in any
// engine.
export function newNonce(): string {
  const bytes = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// Remember a started link across the round trip to Auth0.
//
// Storage failures are swallowed rather than surfaced, matching
// `lib/return-to.ts`: private browsing modes and quota limits both throw here.
// The consequence is a link that cannot complete and has to be retried, which
// is the safe direction — a completion that cannot find its nonce is refused by
// the server, not waved through.
export function rememberPendingLink(pending: PendingLink): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(pending));
  } catch {
    // See above.
  }
}

// The started link, if this browser is the one that started it.
//
// **Read without consuming**, deliberately. The confirmation page reads it on
// every render to know what it is asking about, and a read that cleared it
// would leave the second render — React 18's Strict Mode double-invoke, or
// simply a re-render — with nothing to describe, and a screen that asks
// somebody to approve something it can no longer name. `forgetPendingLink`
// below is called once, when the link has actually completed.
export function readPendingLink(): PendingLink | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingLink>;
    // Shape-checked rather than trusted. The value is read back from storage a
    // whole navigation later and may have been written by an older build, or
    // by hand; sending `undefined` to the API would fail its own validation,
    // but with a message about a malformed request rather than the honest
    // "there is nothing to finish here".
    if (typeof parsed?.nonce !== 'string' || typeof parsed?.token !== 'string') return null;
    return { nonce: parsed.nonce, token: parsed.token, provider: parsed.provider ?? '' };
  } catch {
    return null;
  }
}

// Forget a link, once it has completed or been abandoned.
//
// Left behind on a *failure*, on purpose: several of the server's refusals are
// retryable — an expired request, or signing back in with the same provider —
// and clearing here would turn "try again and choose the other one" into a
// journey that has to be restarted from the shopping list.
export function forgetPendingLink(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to do, and nothing worth failing over.
  }
}

// How a sign-in method is named on screen when the server did not recognise it.
//
// The server returns "" rather than guessing at a provider it has no name for —
// putting a raw Auth0 connection name into a sentence somebody is making a
// security decision about is worse than saying nothing. This is the sentence
// that reads correctly either way, so no caller has to build one.
export function providerLabel(provider: string): string {
  return provider ? `your ${provider} sign-in` : 'the way you just signed in';
}
