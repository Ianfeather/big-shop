import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/router';
import useAuth, { authDisabled } from '@hooks/use-auth';
import { apiPost } from '../lib/api-client';
import { loginRedirectUri } from '../lib/app-origin';
import { rememberReturnTo } from '../lib/return-to';
import {
  forgetPendingLink,
  newNonce,
  rememberPendingLink,
  type PendingLink
} from '../lib/account-link';

// The two halves of account linking recovery, as the components see them.
//
// See `lib/account-link.ts` for the nonce and why it is the load-bearing part,
// and `specs/completed/account-linking-recovery.md` for the whole design.

interface StartLinkResponse {
  token: string;
  provider: string;
}

interface CompleteLinkResponse {
  provider: string;
}

// useStartAccountLink sends somebody off to sign in as the account they are
// claiming.
//
// Three things happen, in this order, and the order matters: the nonce and the
// token are written to this browser's storage **before** any navigation, because
// once `loginWithRedirect` runs the page is gone and nothing else will get the
// chance.
export function useStartAccountLink() {
  const { getAccessTokenSilently, loginWithRedirect } = useAuth();
  const router = useRouter();

  return useMutation({
    mutationFn: async () => {
      const accessToken = await getAccessTokenSilently();
      const nonce = newNonce();
      // The request cannot name a subject: the identity being linked is always
      // the caller's own, taken from the validated token server-side. See
      // `app.LinkStartInput`.
      const started = await apiPost<StartLinkResponse>('/link/start', accessToken, { nonce });
      rememberPendingLink({ nonce, token: started.token, provider: started.provider });

      // **The callback lands on `/list`, and `lib/return-to.ts` forwards on from
      // there.** Sending Auth0 straight to `/link/confirm` would be the obvious
      // shape and is the wrong one twice over: every origin this can resolve to
      // would need a second entry in the tenant's Allowed Callback URLs (so a
      // deploy preview would break, silently, at the last step of the flow), and
      // `pages/_app.tsx` already owns exactly one post-login navigation. That
      // file's own comment says why a second owner is a bad trade at such a
      // delicate moment — Auth0 rewrites the URL in a mount effect before any
      // component renders — and this reuses the mechanism rather than racing it.
      rememberReturnTo('/link/confirm');

      // With auth disabled there is no Auth0 to go to and only one fixed
      // identity, so `loginWithRedirect` is a no-op mock and the journey would
      // simply stop here. Navigating directly keeps the confirmation screen
      // reachable locally — where it will refuse, correctly and legibly, because
      // signing in "again" produces the same subject.
      if (authDisabled) {
        await router.push('/link/confirm');
        return;
      }

      // **`prompt: 'login'` is the proof of ownership.** Without it Auth0
      // silently reuses the session that is already open — which is the empty
      // account they are trying to get away from — and the flow would loop back
      // having established nothing.
      await loginWithRedirect({
        authorizationParams: {
          prompt: 'login',
          redirect_uri: loginRedirectUri()
        }
      });
    }
  });
}

// useCompleteAccountLink finishes a link the person has just approved.
//
// On success every cached query is invalidated, for the same reason accepting an
// invitation does it in `pages/account.tsx`: this request changes which Account
// the browser can reach, so all of it now describes an Account that no longer
// exists. Enumerating keys would need revisiting every time one is added.
export function useCompleteAccountLink() {
  const { getAccessTokenSilently } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (pending: PendingLink) => {
      const accessToken = await getAccessTokenSilently();
      return apiPost<CompleteLinkResponse>('/link/complete', accessToken, {
        token: pending.token,
        nonce: pending.nonce
      });
    },
    onSuccess: () => {
      // Cleared only here. Several refusals are retryable — an expired request,
      // or coming back with the same provider — and forgetting on failure would
      // turn "try again and pick the other one" into a journey restarted from
      // the shopping list.
      forgetPendingLink();
      queryClient.invalidateQueries();
    }
  });
}
