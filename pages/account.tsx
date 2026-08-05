import styles from './account.module.css';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import Invite from '@components/invite';
import useAuth0 from '@hooks/use-auth';
import { apiGet, apiPost } from '../lib/api-client';
import { queryKeys } from '../lib/query-keys';
import Layout, { MainContent, Sidebar } from '@components/layout'
import PageHeading from '@components/page-heading';
import Button from '@components/button';
import type { Invite as InviteModel } from '../types/models';

const List = () => {
  // Tokens of invites this user has already accepted or rejected in this
  // session. Kept instead of a local copy of the whole list so that accept and
  // reject can drop a row immediately, without waiting on (or invalidating and
  // refetching from) the mutation's response.
  let [dismissedTokens, setDismissedTokens] = useState<string[]>([]);
  let [invitee, setInvitee] = useState('');
  let [successMessage, setSuccessMessage] = useState<string | false>(false);
  const { user, getAccessTokenSilently } = useAuth0();
  const queryClient = useQueryClient();

  const { data: fetchedInvites } = useQuery<InviteModel[]>({
    queryKey: queryKeys.invites,
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
    }
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

  return (
    <Layout>
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
        </div>
      </MainContent>
    </Layout>
  )
}

export default List
