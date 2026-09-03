// The browser's half of account linking recovery — see
// `specs/completed/account-linking-recovery.md` and
// `api/internal/pkg/service/link.go`.
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

// What, if anything, the Shopping List should offer about account linking.
//
// **Two conditions, and the second is a bug fix rather than a nicety.** The
// journey out to Auth0 and back to `/link/confirm` rides `lib/return-to.ts`,
// which stores its destination in *sessionStorage* - deliberately, since it
// only ever has to survive one tab's round trip. The nonce does not live there;
// it is in localStorage precisely because the installed PWA can be resumed in
// what the browser treats as a fresh session, and the native wrapper deep-links
// back into the app. On exactly those platforms the nonce would survive and the
// *navigation* would not: the person returns to `/list` signed in as their
// original account, which has recipes, so `noRecipes` is false and there is
// nothing on screen pointing at the link they are halfway through.
//
// So a pending link is offered *whatever* the recipe count, and it wins. That
// makes the return-to a convenience rather than the only thread holding the
// journey together, which is what the spec's "the failure direction is the safe
// one - the person retries" actually requires.
//
// Held here, as a function of three plain values, rather than as a condition
// inside pages/list.tsx: it is the most laboured requirement in the spec and
// the one that regresses silently, and a page that fetches a shopping list, a
// recipe list and a user is not where you want to be asserting it.
export type AccountLinkOffer = 'none' | 'start' | 'finish';

export function accountLinkOffer(
  { recipesResolved, recipeCount, hasPendingLink }:
  { recipesResolved: boolean; recipeCount: number; hasPendingLink: boolean }
): AccountLinkOffer {
  if (hasPendingLink) return 'finish';
  // **Resolved, not just empty.** `useRecipes` defaults to `[]` so consumers
  // can map immediately, which makes an in-flight fetch indistinguishable from
  // a genuinely empty library - and offering on the count alone would flash
  // this on every load, for everybody, including someone with two hundred
  // recipes. pages/account.tsx left the same lesson in its invite message and
  // its deliberately undefaulted `otherMembers`.
  if (recipesResolved && recipeCount === 0) return 'start';
  return 'none';
}

// What to show for a link the server refused.
//
// `lib/api-client.ts`'s ApiError carries the status but not the server's
// message, so the advice is rebuilt here from the status. That duplicates the
// server's copy and is the lesser evil: widening ApiError to carry a body would
// change the shape every call site in the app sees, for one screen. The two are
// kept honest by both deriving from the same closed set of refusals in
// `app/link.go`.
//
// 409 is the one that needs distinguishing and cannot be from a status alone:
// three different conflicts share it. The wording therefore covers all three
// without claiming which, in the same spirit as the invite message in
// pages/account.tsx that covers expired, already-accepted and
// addressed-to-somebody-else with one honest sentence.
export function linkRefusalMessage(status: number | undefined): string {
  if (status === 409) {
    return 'That did not link. You may have signed in again with the same method you were already '
      + 'using — try again and choose the one you signed up with. If this account already has '
      + 'recipes in it, get in touch with support and we will help.';
  }
  if (status === undefined) {
    return 'Something went wrong and nothing has been linked. Please try again.';
  }
  return 'That link request is no longer valid — it may have expired, or been started in a '
    + 'different browser. Start again from your shopping list.';
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
