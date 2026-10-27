import { ApiError } from './api-client';

// Is this error the session ending, rather than a request failing?
//
// **Why this exists.** Auth0 can stop issuing tokens while still reporting
// the user as logged in. With `useRefreshTokens` and `cacheLocation:
// 'localstorage'` (pages/_app.tsx), auth0-spa-js keeps the decoded ID token in
// its own cache entry. When the refresh token expires or is revoked,
// `getTokenSilently` throws `invalid_grant` but leaves that entry alone, so
// `getUser()` still returns the user and `isAuthenticated` stays true.
// This survives a reload: `checkSession` swallows the same error on startup.
// Meanwhile every hooks/use-*.ts query rejects, `data ?? []` turns each one
// into an empty collection, and the app looks like an Account with nothing in
// it. Logging out clears the cache, which is why logging out and back in was
// the only way out.
//
// Two shapes count:
//  - The SDK refusing to produce a token. These codes are the ones
//    auth0-spa-js documents as "send the user to log in interactively"
//    (`useRefreshTokensFallback` in its global.ts). Matched on `error`, not
//    with `instanceof`, because invalid_grant arrives as a plain GenericError.
//  - The API refusing a token it was given, which is what the 2026-08-21 PWA
//    incident looked like from the server: a 401 on every route. A 401 from
//    the Go API only ever means "this token is not acceptable". It is never a
//    per-resource permission answer; those are 403/404.
const REAUTH_ERROR_CODES = new Set([
  'login_required',
  'consent_required',
  'invalid_grant',
  'missing_refresh_token',
]);

export function isSessionExpiredError(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 401;
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { error?: unknown }).error;
  return typeof code === 'string' && REAUTH_ERROR_CODES.has(code);
}

// A loop breaker for the re-login redirect.
//
// The redirect is the right answer when the session has lapsed: a fresh login
// replaces the cached tokens. It is the wrong answer if the *fresh* token is
// refused too, for example when the API and the SPA disagree on audience or
// issuer. Then every arrival would redirect again, forever. So a second
// failure soon after a re-login gives up on redirecting, and the caller logs
// out locally instead. That leaves a logged-out app with a Log In button, which
// is an honest state, rather than a loop or an empty list.
const KEY = 'bigshop:reauthAt';
const WINDOW_MS = 2 * 60 * 1000;

export function reauthAttemptedRecently(now = Date.now()): boolean {
  try {
    const at = Number(window.sessionStorage.getItem(KEY));
    return Number.isFinite(at) && at > 0 && now - at < WINDOW_MS;
  } catch {
    return false;
  }
}

export function recordReauthAttempt(now = Date.now()): void {
  try {
    window.sessionStorage.setItem(KEY, String(now));
  } catch {
    // Without storage the guard cannot remember the first attempt. That costs
    // the loop protection, not the re-login, so it is not a reason to fail.
  }
}
