import { useEffect, useRef, useState } from 'react';
import useAuth0 from '@hooks/use-auth';
import { ApiError, apiPost, apiPatch } from '../lib/api-client';
import { arrivedFromLogin } from '../lib/auth-callback';
import type { User } from '../types/models';

// The user's browser timezone, if it will tell us.
//
// Sent on the POST /user below rather than through a route or a round trip of
// its own - it is one more field on a payload that exists.
//
// The server stores it on insert only and never updates it, so in practice this
// value matters on a first login and is ignored on every subsequent one. It is
// read by the onboarding email sequence, which sends at 10:00 in the recipient's
// morning instead of ours (specs/completed/email.md); nothing in the UI uses it.
//
// Guarded rather than called directly because resolvedOptions().timeZone is
// specified to return the runtime's zone but is not universally reliable, and
// this runs inside the effect that creates the User - an exception here would
// take the signup with it, which is a spectacularly bad trade for a nicety. An
// absent zone is a supported state all the way down: the column is nullable and
// the sender falls back to Europe/London.
const browserTimezone = (): string | undefined => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
};

// Makes sure the signed-in person actually has a User row and an Account, and
// reports when it is safe to render a page that depends on one.
//
// This used to live in pages/index.tsx, and could, because the Auth0 callback
// landed on `/` - so every new user passed through the homepage on their way
// in. The callback now goes straight to /list (lib/app-origin.ts), which is
// what makes the installed PWA open where it says it does, and that removes the
// guarantee. Hence the move up to InnerApp: the upsert has to run wherever the
// user first lands, not on one particular page.
//
// **Why a page must be able to wait for it.** POST /user is what creates the
// row on a first login. Until it returns, the caller has no `account_user` row,
// and internal/pkg/common/caller.go is explicit about what that means: the
// lookup surfaces sql.ErrNoRows and handlers turn it into a **500**. A brand
// new user sent to /list would fire the shopping-list and recipe requests
// against an account that does not exist yet and see the page break on their
// very first screen.
//
// **Why waiting is nonetheless conditional.** Blocking every authenticated page
// load on a round trip would put a blank frame in front of the thing this whole
// change exists to make feel immediate - opening the app. So the wait is scoped
// to the one arrival where the account genuinely might not exist yet: the
// return from Auth0, which `arrivedFromLogin` identifies. Any later launch
// renders at once and repairs in the background, because by then the row was
// either created on the login that preceded it or it never will be.
//
// A failure resolves the gate rather than holding it. Stranding someone on a
// blank screen because an upsert 500'd is worse than letting the page load and
// fail visibly, and the next launch runs the repair again.
export default function useAccountSetup(): { accountReady: boolean; identityConflict: boolean } {
  const { isAuthenticated, isLoading, user, getAccessTokenSilently } = useAuth0();
  const [settled, setSettled] = useState(false);
  const [identityConflict, setIdentityConflict] = useState(false);
  // Runs once per app load, not once per render or per route change. InnerApp
  // is mounted by _app.tsx and survives client-side navigation, so moving
  // between pages costs nothing.
  //
  // This is more often than before the move, not the same: the upsert used to
  // run only when somebody visited `/`, and now runs on every authenticated
  // hard load. That is the point - a PWA launch straight into /list never
  // touched `/` and so never got the repair. The cost is bounded and the
  // server is built for it: AddUser is an upsert, and app/user.go sends the
  // welcome email only when it reports it actually created the row, so the
  // extra calls cannot turn into extra email.
  const startedRef = useRef(false);

  useEffect(() => {
    if (isLoading || !isAuthenticated || !user) return;
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      try {
        const token = await getAccessTokenSilently();
        // An idempotent upsert, so running it for an already-known user costs
        // one request and repairs the case where the original call failed.
        const saved = await apiPost<User>('/user', token, {
          name: user.name,
          email: user.email,
          timezone: browserTimezone()
        });
        // `onboarded` is recorded and no longer routes anybody. It used to
        // decide whether a first-time user was forwarded to /list or left on
        // the marketing homepage; now everyone goes to /list and the flag is
        // just a fact about the account, waiting for onboarding that happens
        // on the list page itself. See pages/index.tsx.
        if (!saved?.onboarded) {
          await apiPatch('/user/onboarding', token).catch(() => undefined);
        }
      } catch (err) {
        // **The one failure that is not swallowed.** A 409 from POST /user
        // means the signed-in Auth0 subject is new, but the email address on it
        // already belongs to a different subject - so this is the same human
        // arriving through a second login provider, and the server has refused
        // to hand them the brand-new empty Account they would otherwise get
        // (netlify-functions/recipes/internal/pkg/service/user.go's
        // ConflictingUserID).
        //
        // Swallowing it the way everything else here is swallowed would deliver
        // precisely the experience the guard exists to prevent: the page loads,
        // no account resolves behind it, and somebody who has used Big Shop for
        // a year concludes their recipes are gone. It has to be said out loud,
        // so it is raised to InnerApp and rendered instead of the app.
        //
        // Every other failure keeps the old behaviour for the reason given
        // above - a transient upsert failure must release the gate rather than
        // put a wall in front of a user whose account is perfectly fine.
        if (err instanceof ApiError && err.status === 409) {
          setIdentityConflict(true);
        }
      }
      setSettled(true);
    })();
  }, [isLoading, isAuthenticated, user]); // eslint-disable-line react-hooks/exhaustive-deps

  // `accountReady` is deliberately unchanged by a conflict: the gate answers
  // "has the upsert finished", and it has - it finished by refusing. InnerApp
  // reads the two separately and lets the conflict win, which keeps this hook
  // from having to encode that precedence.
  return { accountReady: settled || !arrivedFromLogin, identityConflict };
}
