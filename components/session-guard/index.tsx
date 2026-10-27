import { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { useQueryClient } from '@tanstack/react-query';
import useAuth from '@hooks/use-auth';
import { ApiError } from '../../lib/api-client';
import { loginRedirectUri } from '../../lib/app-origin';
import { rememberReturnTo } from '../../lib/return-to';
import {
  isSessionExpiredError,
  reauthAttemptedRecently,
  recordReauthAttempt,
} from '../../lib/session-expiry';

// Recovers from a session that has ended underneath an open app, silently
// when it can, and otherwise sends the user back through login rather than
// leaving them on a logged-in page with no data. lib/session-expiry.ts explains
// how that state comes about.
//
// Three layers, cheapest first:
//  1. A 401 from the API means the cached access token was refused, though the
//     cache still thinks it is good (skew, revocation, an issuer change). Ask
//     for a new one, skipping the cache, and refetch. Nobody sees anything.
//  2. If the refresh token is dead too, the SDK tries a hidden iframe against
//     the Auth0 login cookie before it gives up (`useRefreshTokensFallback` in
//     pages/_app.tsx). That happens inside getAccessTokenSilently, so this
//     component only ever sees what is left after it.
//  3. What is left is a login that has genuinely ended, so redirect to log in,
//     and come back to the same page.
//
// It watches the query and mutation caches rather than wrapping each hook.
// Every hooks/use-*.ts call fetches its own token, so the caches are the one
// place that sees every failure. That also means a hook added later is covered
// without anyone having to remember this exists.
//
// Mounted inside InnerApp because it needs both the Auth0 context and the
// QueryClient, and because only gated pages hold a session that can lapse.
// Renders nothing.
export default function SessionGuard() {
  const { loginWithRedirect, logout, getAccessTokenSilently } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  // A lapsed session fails every in-flight query at once. Respond to the first
  // and ignore the rest: either a refresh is already underway that will refetch
  // them, or the page is about to navigate away.
  const redirecting = useRef(false);
  const refreshing = useRef(false);
  // When layer 1 last ran. A 401 soon after it means a fresh token was refused
  // as well, which another refresh will not fix.
  const refreshedAt = useRef(0);

  useEffect(() => {
    const reauthenticate = () => {
      if (redirecting.current) return;
      redirecting.current = true;

      if (reauthAttemptedRecently()) {
        // A fresh login was refused too. See the loop breaker in
        // lib/session-expiry.ts. Clearing the local session flips
        // isAuthenticated, and InnerApp's existing bounce takes it from there.
        logout({ openUrl: false });
        return;
      }

      recordReauthAttempt();
      // Come back to this page, not /list. InnerApp consumes this once the
      // login resolves, the same way it does for a logged-out deep link.
      rememberReturnTo(router.asPath);
      loginWithRedirect({ authorizationParams: { redirect_uri: loginRedirectUri() } });
    };

    // Layer 1. Judged on the refetch's outcome rather than on later events:
    // refetchQueries cancels and reissues anything still in flight, so a
    // request sent with the old token cannot arrive afterwards looking like a
    // refusal of the new one.
    const refreshAndRefetch = async () => {
      refreshing.current = true;
      try {
        await getAccessTokenSilently({ cacheMode: 'off' });
        refreshedAt.current = Date.now();
        await queryClient.refetchQueries({ type: 'active' });
        const stillRefused = queryClient
          .getQueryCache()
          .findAll({ type: 'active' })
          .some((q) => q.state.status === 'error' && isSessionExpiredError(q.state.error));
        if (stillRefused) reauthenticate();
      } catch (error) {
        // The refresh itself failed. If that is the session ending, layer 3.
        // Anything else, a network blip say, leaves the page as it is.
        if (isSessionExpiredError(error)) reauthenticate();
      } finally {
        refreshing.current = false;
      }
    };

    const onError = (error: unknown) => {
      if (redirecting.current || refreshing.current) return;
      if (!isSessionExpiredError(error)) return;

      const apiRefusedToken = error instanceof ApiError && error.status === 401;
      if (apiRefusedToken && Date.now() - refreshedAt.current > REFRESH_WINDOW_MS) {
        refreshAndRefetch();
        return;
      }

      reauthenticate();
    };

    const unsubscribeQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') onError(event.action.error);
    });
    const unsubscribeMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event?.type === 'updated' && event.action.type === 'error') onError(event.action.error);
    });
    return () => {
      unsubscribeQueries();
      unsubscribeMutations();
    };
  }, [queryClient]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

const REFRESH_WINDOW_MS = 2 * 60 * 1000;
