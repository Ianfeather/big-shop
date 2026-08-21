import styles from './account.module.css';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Invite from '@components/invite';
import useAuth0 from '@hooks/use-auth';
import { apiDelete, apiGet, apiPost } from '../lib/api-client';
import { queryKeys } from '../lib/query-keys';
import Layout, { MainContent, Sidebar } from '@components/layout'
import Toast from '@components/toast';
import PageHeading from '@components/page-heading';
import Button from '@components/button';
import { useCookieSettings } from '@components/consent-banner';
import { inviteSent } from '../lib/analytics/events';
import type { Account, Invite as InviteModel } from '../types/models';

const List = () => {
  // Tokens of invites this user has already accepted or rejected in this
  // session. Kept instead of a local copy of the whole list so that accept and
  // reject can drop a row immediately, without waiting on (or invalidating and
  // refetching from) the mutation's response.
  let [dismissedTokens, setDismissedTokens] = useState<string[]>([]);
  let [invitee, setInvitee] = useState('');
  // The token from an emailed invite link, and the message that points at it.
  // Two pieces of state rather than one derived value because the effect below
  // strips ?invite from the URL immediately - deriving either from the router
  // would make them vanish on the tick they appeared.
  let [highlightedToken, setHighlightedToken] = useState<string | null>(null);
  let [inviteMessage, setInviteMessage] = useState<string | null>(null);
  let [successMessage, setSuccessMessage] = useState<string | false>(false);
  // Whether the delete confirmation is open. Deliberately a second, explicit
  // step rather than a window.confirm(): the whole point of the panel is the
  // sentence naming which of the two outcomes will happen, and a native dialog
  // has nowhere to put it.
  let [confirmingDelete, setConfirmingDelete] = useState(false);
  let [deleteError, setDeleteError] = useState<string | false>(false);
  // Set the moment the deletion succeeds, and it does two jobs. It swaps the
  // page for a confirmation, and it switches off the queries below - without
  // that, every account-scoped query on this page immediately refetches against
  // a user who no longer exists and retries its way through a row of 500s while
  // the browser is on its way out.
  // null until the deletion succeeds, then the server's answer to "did the
  // Account go too". Not a boolean `deleted` plus a guess: the confirmation
  // screen has to say which of the two things happened, and only the server
  // knows - it decides the branch inside the transaction, from rows that no
  // longer exist by the time the response arrives.
  let [deletedOutcome, setDeletedOutcome] = useState<{ accountDeleted: boolean } | null>(null);
  const deleted = deletedOutcome !== null;
  const { user, getAccessTokenSilently, logout } = useAuth0();
  const router = useRouter();
  const queryClient = useQueryClient();
  const openCookieSettings = useCookieSettings();

  const { data: fetchedInvites, isSuccess: invitesLoaded } = useQuery<InviteModel[]>({
    queryKey: queryKeys.invites,
    enabled: !deleted,
    queryFn: async () => {
      const token = await getAccessTokenSilently();
      return apiGet<InviteModel[]>('/invites', token);
    }
  });

  // Derived rather than copied into state by an effect. That effect only ran
  // when fetchedInvites was non-empty, so a server response of [] left the
  // previous list on screen; deriving also drops the extra cascading render
  // react-hooks/set-state-in-effect flagged (follow-ups.md #32).
  const invites = (fetchedInvites ?? []).filter(
    invite => !dismissedTokens.includes(invite.token)
  );

  // The emailed invite link lands here as /account?invite=<token>. Read it once,
  // then strip it via router.replace so a reload or a shared link doesn't
  // re-announce an invitation that has since been dealt with - the same shape
  // pages/recipes/[id]/index.tsx uses for its one-time ?stored= toast.
  //
  // **Gated on the invites query having resolved, not just on the router.**
  // Without that, the effect runs while fetchedInvites is still undefined and
  // every arrival from an email is told the invitation no longer exists.
  //
  // It deliberately does not accept anything. Accepting moves this user into a
  // different Account and disables their existing one; that needs a click on the
  // card below, not a click in a mail client.
  useEffect(() => {
    if (!router.isReady || !invitesLoaded) return;
    const token = router.query.invite;
    if (typeof token !== 'string') return;

    const match = invites.find(invite => invite.token === token);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHighlightedToken(match ? token : null);
    setInviteMessage(match
      ? `${match.account_holder} invited you to share their account. Accept or decline below.`
      // Expired, already accepted, and addressed to somebody else are one case
      // from here: GET /invites simply does not contain the token, and the
      // server has no way to tell us which. One honest message covering all
      // three beats guessing at the likeliest and being wrong.
      : 'That invitation is no longer available \u2014 it may already have been accepted, declined, or expired. Ask whoever invited you to send a new one.');

    router.replace('/account', undefined, { shallow: true });
  }, [router.isReady, invitesLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // The Account's other members, which is what decides whether deleting this
  // user also deletes the Recipes. Read from the route the page can already
  // ask for rather than a count of its own - GET /account returns the enabled
  // members, so `users.length > 1` is the same question the server asks.
  const { data: account } = useQuery<Account>({
    queryKey: queryKeys.account,
    enabled: !deleted,
    queryFn: async () => {
      const token = await getAccessTokenSilently();
      return apiGet<Account>('/account', token);
    }
  });

  // Deliberately not defaulted. `account?.users?.length ?? 1` would read as
  // "sole member" while the request is still in flight or after it failed,
  // which is the confirmation naming the wrong outcome - telling somebody their
  // recipes will be deleted when they will not, or the reverse. Undefined means
  // "not known yet", and the confirmation refuses to render until it is.
  const otherMembers = account?.users ? Math.max(account.users.length - 1, 0) : undefined;
  const sharedAccount = otherMembers !== undefined && otherMembers > 0;

  const deleteAccountMutation = useMutation({
    mutationFn: async () => {
      const token = await getAccessTokenSilently();
      return apiDelete<{ accountDeleted: boolean }>('/account', token);
    },
    onSuccess: (result) => {
      // Both of these are needed, and neither is sufficient. Setting the
      // outcome switches the queries above off (`enabled: !deleted`) so nothing
      // refetches for a user who has just ceased to exist; clearing drops what
      // is already cached. React batches the state update, so the clear on the
      // next line still runs against enabled observers - the ordering is not a
      // guarantee, which is why the `enabled` flag does the real work.
      setDeletedOutcome(result);
      queryClient.clear();
      // Then out. In production this redirects to Auth0 and back to the
      // marketing page; the confirmation below is what the user sees in the
      // moment before that, and all they see when auth is disabled locally.
      logout({ logoutParams: { returnTo: window.location.origin } });
    },
    // Deliberately surfaced rather than swallowed. Every failure in the
    // deletion sequence leaves a gated, retryable Account behind, so "try
    // again" is honest advice rather than a shrug.
    onError: () => setDeleteError('Something went wrong and your account has not been deleted. Please try again.')
  });

  const acceptMutation = useMutation({
    mutationFn: async (token: string) => {
      const accessToken = await getAccessTokenSilently();
      return apiPost('/invite/accept', accessToken, { token });
    },
    onSuccess: () => {
      // Accepting moves this user into a different Account entirely
      // (DisableUserAccount then AddUserToAccount, server-side). Every cached
      // query is account-scoped, so all of it now describes the Account they
      // just left - the Recipes above all. Invalidate the lot rather than
      // enumerate keys that would need revisiting every time one is added.
      queryClient.invalidateQueries();
    }
  });

  const rejectMutation = useMutation({
    mutationFn: async (token: string) => {
      const accessToken = await getAccessTokenSilently();
      return apiPost('/invite/reject', accessToken, { token });
    },
    // The rejected invite is deleted server-side. handleReject already drops it
    // from the local list below; this keeps the cache from re-seeding it on the
    // next mount.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.invites });
    }
  });

  // No invalidation: GET /invites returns invites addressed to the current
  // user's email, and sending one creates a row for somebody else's. The
  // sender's own list is unchanged.
  const inviteMutation = useMutation({
    mutationFn: async (email: string) => {
      const accessToken = await getAccessTokenSilently();
      return apiPost('/invite', accessToken, { email });
    },
    // On success only, which matters more here than elsewhere: follow-ups.md #46
    // records that POST /invite answers 400 whenever the email fails to send,
    // and SENDGRID_API_KEY is set nowhere - so counting clicks would report a
    // thriving sharing feature that has never once worked. The email address is
    // of course not a parameter.
    onSuccess: () => inviteSent()
  });

  // TODO: Error handling
  function handleAccept(token: string) {
    // Next steps:
    // add user menu
    acceptMutation.mutate(token);
    setDismissedTokens(prev => [...prev, token]);
    setSuccessMessage('Great! You are now part of the same account and have a shared set of recipes.');
  }

  function handleReject(token: string) {
    rejectMutation.mutate(token);
    setDismissedTokens(prev => [...prev, token]);
  }

  function handleInvite() {
    inviteMutation.mutate(invitee);
    setSuccessMessage(`An invite is on its way to ${invitee}`);
    setInvitee('');
  }

  if (deletedOutcome) {
    return (
      <Layout>
        <MainContent name="Shopping List">
          {/* Which of the two outcomes actually happened, taken from the
              server's own answer rather than re-derived here. The panel above
              said which one to expect; this confirms it, and they must not be
              able to disagree. */}
          <PageHeading
            subheading={
              deletedOutcome.accountDeleted
                ? 'Your account and everything in it have been removed. Thanks for cooking with us.'
                : 'Everything about you has been removed. The recipes and shopping list stay with the account you shared.'
            }
          >
            Your account is deleted
          </PageHeading>
          <p>
            You are being signed out. If you would like to start again, you are welcome to{' '}
            <Link href="/">make a new account</Link>.
          </p>
        </MainContent>
      </Layout>
    );
  }

  return (
    <Layout toast={inviteMessage && <Toast message={inviteMessage} onDismiss={() => setInviteMessage(null)} />}>
      <MainContent name="Shopping List">
        {/* The old h1 was a whole sentence, which at masthead size would have
            been a paragraph in 40px serif - it reads as the subheading it
            always was, under a title. */}
        <PageHeading subheading={`Hi ${user?.name ?? 'there'}! You can use this page to customize your account.`}>
          Your account
        </PageHeading>
        <div className={styles.twoColumnGrid}>
          { !!invites.length && (
            <div className={styles.accountModule}>
                <>
                  <h3 className={styles.moduleHeading}>You have been invited to join another user&apos;s account</h3>
                  {
                    invites.map(invite => (
                      <Invite {...invite}
                        key={invite.token}
                        highlighted={invite.token === highlightedToken}
                        onAccept={() => handleAccept(invite.token)}
                        onReject={() => handleReject(invite.token)}
                      />
                    ))
                  }
                </>
            </div>
          )}
          <div className={styles.accountModule}>
            <h3 className={styles.moduleHeading}>Invite someone to share your account.</h3>
            <p>Sharing an account with someone means you will have access to the same recipes and shopping list. </p>
            <div className={styles.inviteForm}>
              <input className={styles.input} type="text" value={invitee} onChange={(e) => setInvitee(e.target.value)} />
              <Button style="primary" onClick={handleInvite}>Invite</Button>
            </div>
            { successMessage && (
              <h3>{successMessage}</h3>
            )}
          </div>

          {/* The in-app half of the withdrawal path. The banner asks the
              question on the marketing page, and both public pages carry a
              "Cookie settings" control in their footer - but a logged-in user
              never sees either of those again, and components/layout has no
              footer to put one in. Without this, consent could be given once
              and never revisited, which is the thing that makes it not consent.
              /account is where it belongs rather than the user menu: it is
              already the page for "things about you", and it is one click from
              anywhere via that menu. */}
          <div className={styles.accountModule}>
            <h3 className={styles.moduleHeading}>Privacy and cookies</h3>
            <p>
              What Big Shop stores, and who else sees it, is set out in the{' '}
              <Link href="/privacy">privacy policy</Link>. Analytics is the one part you choose,
              and you can change your mind whenever you like.
            </p>
            <Button style="primary" onClick={openCookieSettings}>Cookie settings</Button>
          </div>

          {/* Deletion lives here rather than behind a settings sub-page: this is
              already the page for "things about you", and burying the control
              is not the same as making it considered. What makes it considered
              is the confirmation step below, which names the outcome. */}
          <div className={styles.accountModule}>
            <h3 className={styles.moduleHeading}>Delete your account</h3>
            {!confirmingDelete && (
              <>
                <p>
                  This removes you from Big Shop completely &mdash; your login, your name and
                  email, and every invite you have sent or received.
                </p>
                <Button
                  style="danger"
                  onClick={() => { setDeleteError(false); setConfirmingDelete(true); }}
                  disabled={otherMembers === undefined}
                >
                  Delete your account
                </Button>
              </>
            )}
            {confirmingDelete && (
              <div className={styles.confirmDelete}>
                {/* The sentence this whole panel exists for. The two outcomes
                    are invisible from the outside and are the thing people will
                    be angriest about getting wrong, so the difference is stated
                    before the button is pressed, not after. */}
                <p className={styles.confirmQuestion}>
                  {sharedAccount ? (
                    <>
                      <strong>Your recipes will stay</strong> with the account you share with{' '}
                      {otherMembers} other {otherMembers === 1 ? 'person' : 'people'}. They keep the
                      recipes and the shopping list; you are removed from the account and everything
                      about you is deleted.
                    </>
                  ) : (
                    <>
                      <strong>Your recipes will be deleted.</strong>{' '}
                      You are the only person on this account, so the account goes too &mdash;
                      every recipe, your shopping list and its history.
                    </>
                  )}
                </p>
                <p>This cannot be undone.</p>
                <div className={styles.confirmActions}>
                  <Button
                    style="danger"
                    outline={false}
                    onClick={() => deleteAccountMutation.mutate()}
                    disabled={deleteAccountMutation.isPending}
                  >
                    {deleteAccountMutation.isPending ? 'Deleting\u2026' : 'Yes, delete my account'}
                  </Button>
                  <Button onClick={() => setConfirmingDelete(false)} disabled={deleteAccountMutation.isPending}>
                    Cancel
                  </Button>
                </div>
                {deleteError && <p className={styles.deleteError}>{deleteError}</p>}
              </div>
            )}
          </div>

        </div>
      </MainContent>
    </Layout>
  )
}

export default List
