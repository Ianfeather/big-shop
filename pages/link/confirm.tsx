import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import Layout, { Grid, MainContent } from '@components/layout';
import PageHeading from '@components/page-heading';
import Button from '@components/button';
import Message from '@components/message';
import { ApiError } from '../../lib/api-client';
import {
  readPendingLink,
  providerLabel,
  linkRefusalMessage,
  type PendingLink
} from '../../lib/account-link';
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
// own; `hooks/use-account-link.ts` says why. If that navigation is lost — the
// installed PWA and the native wrapper are the cases — the Shopping List offers
// a way back here, because the nonce outlives the navigation; see
// `lib/account-link.ts`'s accountLinkOffer.

// The page's chrome, which all four states share.
//
// Extracted because the alternative is the same four-deep wrapper written out
// four times with the title string in each, and a page whose whole job is to be
// read carefully should not bury its copy in repeated scaffolding.
const ConfirmLayout = ({ title, subheading, children }: {
  title: string;
  subheading: string;
  children?: ReactNode;
}) => (
  <Layout pageTitle="Link account">
    <Grid>
      <MainContent fullHeight={false}>
        <PageHeading subheading={subheading}>{title}</PageHeading>
        {children}
      </MainContent>
    </Grid>
  </Layout>
);

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
    return <ConfirmLayout title="Linking your account" subheading="One moment." />;
  }

  // Nothing to finish. The commonest honest cause is finishing in a different
  // browser from the one that started it — which is the nonce doing its job, so
  // the copy explains it as a rule rather than as a fault.
  if (pending === null) {
    return (
      <ConfirmLayout
        title="Nothing to link"
        subheading="There is nothing waiting to be linked in this browser."
      >
        <p>
          Linking has to be finished in the same browser it was started in. If you started
          somewhere else, go back there and try again &mdash; otherwise you can start over
          from your <Link href="/list">shopping list</Link>.
        </p>
      </ConfirmLayout>
    );
  }

  if (complete.isSuccess) {
    return (
      <ConfirmLayout title="You are back in" subheading="Your recipes are where you left them.">
        <p>
          From now on {providerLabel(complete.data.provider)} reaches this account too, so it
          does not matter which one you use. Have a look at{' '}
          <Link href="/recipes">your recipes</Link> or head to your{' '}
          <Link href="/list">shopping list</Link>.
        </p>
      </ConfirmLayout>
    );
  }

  return (
    <ConfirmLayout
      title="Link your sign-ins"
      subheading="Check this is what you meant to do before you finish."
    >
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
        <Message
          status="error"
          message={linkRefusalMessage(
            complete.error instanceof ApiError ? complete.error.status : undefined
          )}
        />
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
    </ConfirmLayout>
  );
};

export default ConfirmLink;
