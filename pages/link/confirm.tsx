import { useEffect, useState } from 'react';
import Link from 'next/link';
import Layout, { Grid, MainContent } from '@components/layout';
import PageHeading from '@components/page-heading';
import Button from '@components/button';
import { ApiError } from '../../lib/api-client';
import { readPendingLink, providerLabel, type PendingLink } from '../../lib/account-link';
import { useCompleteAccountLink } from '@hooks/use-account-link';
import styles from './confirm.module.css';

// Where somebody lands after re-authenticating as the account they are claiming.
//
// **This page writes nothing until they accept**, and that is its entire reason
// for existing rather than the link completing on arrival. By this point they
// have done everything the server needs — they hold a token, its nonce, and a
// session as the original account — so finishing automatically would work. It
// would also mean a permanent new way into somebody's account was granted by a
// navigation, which is exactly the shape `specs/account-linking-recovery.md`
// rejects an emailed confirmation link for. The last step is a click on a screen
// that says plainly what the click does.
//
// Reached via `lib/return-to.ts` rather than as an Auth0 callback URL of its
// own; `hooks/use-account-link.ts` says why.

// `pending` is read once, on mount, rather than during render.
//
// It comes from localStorage, which is unavailable while Next renders this on
// the server — so reading it in the render body makes the first client render
// disagree with the server's HTML and React discards the tree with a hydration
// error. `undefined` is "not looked yet" and `null` is "looked, and there is
// nothing", which the screen has to tell apart: a spinner and "there is nothing
// to finish here" are different answers.
type Pending = PendingLink | null | undefined;

const ConfirmLink = () => {
  const [pending, setPending] = useState<Pending>(undefined);
  const complete = useCompleteAccountLink();

  useEffect(() => {
    setPending(readPendingLink()); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);

  if (pending === undefined) {
    return (
      <Layout pageTitle="Link account">
        <Grid>
          <MainContent fullHeight={false}>
            <PageHeading subheading="One moment.">Linking your account</PageHeading>
          </MainContent>
        </Grid>
      </Layout>
    );
  }

  // Nothing to finish. The commonest honest cause is finishing in a different
  // browser from the one that started it — which is the nonce doing its job, so
  // the copy explains it as a rule rather than as a fault.
  if (pending === null) {
    return (
      <Layout pageTitle="Link account">
        <Grid>
          <MainContent fullHeight={false}>
            <PageHeading subheading="There is nothing waiting to be linked in this browser.">
              Nothing to link
            </PageHeading>
            <p>
              Linking has to be finished in the same browser it was started in. If you started
              somewhere else, go back there and try again &mdash; otherwise you can start over
              from your <Link href="/list">shopping list</Link>.
            </p>
          </MainContent>
        </Grid>
      </Layout>
    );
  }

  if (complete.isSuccess) {
    return (
      <Layout pageTitle="Link account">
        <Grid>
          <MainContent fullHeight={false}>
            <PageHeading subheading="Your recipes are where you left them.">
              You are back in
            </PageHeading>
            <p>
              From now on {providerLabel(complete.data.provider)} reaches this account too, so it
              does not matter which one you use. Have a look at{' '}
              <Link href="/recipes">your recipes</Link> or head to your{' '}
              <Link href="/list">shopping list</Link>.
            </p>
          </MainContent>
        </Grid>
      </Layout>
    );
  }

  return (
    <Layout pageTitle="Link account">
      <Grid>
        <MainContent fullHeight={false}>
          <PageHeading subheading="Check this is what you meant to do before you finish.">
            Link your sign-ins
          </PageHeading>

          {/* The sentence the whole page exists for. It names what is being
              granted and what it will reach, in that order, because the person
              reading it has just been through two sign-in screens and may not
              be certain which account they are looking at. */}
          <p className={styles.statement}>
            You are about to let <strong>{providerLabel(pending.provider)}</strong> reach this
            account. After this, signing in either way brings you to these same recipes and the
            same shopping list.
          </p>
          <p>
            The empty account you just came from will be removed. Nothing here changes, and
            nothing is deleted from this account.
          </p>

          { complete.isError && (
            <p className={styles.error} role="alert">
              { complete.error instanceof ApiError
                // Every refusal from POST /link/complete is written for
                // somebody to read - see app/link.go's linkRefusal - so the
                // server's message is shown rather than replaced with a
                // generic one. ApiError carries only the status, so the
                // fallback below is what a non-ApiError gets.
                ? refusalFor(complete.error)
                : 'Something went wrong and nothing has been linked. Please try again.' }
            </p>
          )}

          <div className={styles.actions}>
            <Button
              style="primary"
              onClick={() => complete.mutate(pending)}
              disabled={complete.isPending}
            >
              {complete.isPending ? 'Linking…' : 'Yes, link them'}
            </Button>
            <Link href="/list" className={styles.cancel}>Cancel</Link>
          </div>
        </MainContent>
      </Grid>
    </Layout>
  );
};

// What to show for a refused completion.
//
// `lib/api-client.ts`'s ApiError carries the status but not the server's
// message, so the advice is reconstructed here from the status. That is a
// duplication of the server's copy and it is the lesser evil: widening ApiError
// to carry a body would change the shape every call site in the app sees, for
// one screen. The two are kept honest by both being derived from the same
// closed set of refusals in `app/link.go`.
//
// 409 is the one that needs distinguishing and cannot be, from a status alone:
// three different conflicts share it. The wording therefore covers all three
// without claiming which, in the same spirit as the invite message in
// `pages/account.tsx` that covers expired, already-accepted and addressed-to-
// somebody-else with one honest sentence.
function refusalFor(error: ApiError): string {
  if (error.status === 409) {
    return 'That did not link. You may have signed in again with the same method you were already '
      + 'using — try again and choose the one you signed up with. If this account already has '
      + 'recipes in it, get in touch with support and we will help.';
  }
  return 'That link request is no longer valid — it may have expired, or been started in a '
    + 'different browser. Start again from your shopping list.';
}

export default ConfirmLink;
