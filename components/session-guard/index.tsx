import { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { useQueryClient } from '@tanstack/react-query';
import useAuth from '@hooks/use-auth';
import { loginRedirectUri } from '../../lib/app-origin';
import { rememberReturnTo } from '../../lib/return-to';
import {
  isSessionExpiredError,
  reauthAttemptedRecently,
  recordReauthAttempt,
} from '../../lib/session-expiry';

// Sends someone back through login when their session has ended underneath
// them, instead of leaving them on a logged-in page with no data.
// lib/session-expiry.ts explains how that state comes about.
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
  const { loginWithRedirect, logout } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  // A lapsed session fails every in-flight query at once. Respond to the first
  // and ignore the rest: the page is about to navigate away anyway.
  const handled = useRef(false);

  useEffect(() => {
    const onError = (error: unknown) => {
      if (handled.current || !isSessionExpiredError(error)) return;
      handled.current = true;

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
