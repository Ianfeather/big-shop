import type { NextApiRequest } from 'next';
import { serverApiHost } from './api-host';

// Who the caller of a Next.js API route is.
//
// These routes hold no JWKS, no audience and no issuer, and nothing in the
// frontend's dependencies can verify an Auth0 token - the Go API is the only
// thing in this system that decides whether one is good (the same reason
// lib/recipe-import/known-names.ts forwards the caller's header rather than
// reading it). So authenticating here means asking it: one GET /account with
// the caller's own Authorization header. A 2xx means the token passed Auth0
// validation, and the body says which Account it resolved to.
//
// The Account, not the user, is the unit of ownership everywhere else in Big
// Shop - every Go handler scopes its queries to account_id, and two people
// sharing an Account are meant to see each other's data - so it is the right
// key for anything a route here needs to own.
//
// Under DISABLE_AUTH the Go API resolves every request to the fixed dev user,
// so this passes for any header value. That is the same latitude local dev
// already gives every other endpoint.
export type AuthenticatedAccount = { id: number };

export type AuthenticationResult =
  | { ok: true; account: AuthenticatedAccount }
  | { ok: false; status: 401 | 500; error: string };

export async function authenticateAccount(req: NextApiRequest): Promise<AuthenticationResult> {
  // API_HOST_INTERNAL, not NEXT_PUBLIC_API_HOST - this runs in a Netlify
  // function, where the latter's production value is a relative path. See
  // lib/api-host.ts.
  const host = serverApiHost();
  if (!host) {
    console.error('No API host configured (API_HOST_INTERNAL, or NEXT_PUBLIC_API_HOST locally) - cannot authenticate the caller');
    return { ok: false, status: 500, error: 'Authentication is not configured' };
  }

  const authorization = req.headers.authorization;
  if (!authorization) {
    return { ok: false, status: 401, error: 'Authentication required' };
  }

  try {
    const res = await fetch(`${host}/account`, { headers: { Authorization: authorization } });

    if (!res.ok) {
      return { ok: false, status: 401, error: 'Authentication required' };
    }

    const account = (await res.json()) as { id?: unknown };
    if (typeof account?.id !== 'number') {
      console.error('Token accepted but the API returned no account id');
      return { ok: false, status: 500, error: 'Could not verify authentication' };
    }

    return { ok: true, account: { id: account.id } };
  } catch (e) {
    // Unlike fetchKnownNames, this deliberately does not degrade to a usable
    // result when the API is unreachable. Losing canonical names costs a bonus;
    // a gate that fails open is not a gate.
    console.error('Could not reach the API to authenticate the caller', e);
    return { ok: false, status: 500, error: 'Could not verify authentication' };
  }
}
