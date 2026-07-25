import styles from './account.module.css';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import Invite from '@components/invite';
import useAuth0 from '@hooks/use-auth';
import { apiGet, apiPost } from '../lib/api-client';
import Layout, { MainContent, Sidebar } from '@components/layout'
import Button from '@components/button';
import type { Invite as InviteModel } from '../types/models';

const List = () => {
  let [invites, setInvites] = useState<InviteModel[]>([]);
  let [invitee, setInvitee] = useState('');
  let [successMessage, setSuccessMessage] = useState<string | false>(false);
  const { user, getAccessTokenSilently } = useAuth0();

  const { data: fetchedInvites } = useQuery<InviteModel[]>({
    queryKey: ['invites'],
    queryFn: async () => {
      const token = await getAccessTokenSilently();
      return apiGet<InviteModel[]>('/invites', token);
    }
  });

  // invites stays local state, seeded from the query result: accept/reject
  // optimistically remove an entry from this list without waiting on (or
  // invalidating/refetching from) the mutation's response, same as before.
  useEffect(() => {
    if (fetchedInvites?.length) {
      setInvites(fetchedInvites);
    }
  }, [fetchedInvites]);

  const acceptMutation = useMutation({
    mutationFn: async (token: string) => {
      const accessToken = await getAccessTokenSilently();
      return apiPost('/invite/accept', accessToken, { token });
    }
  });

  const rejectMutation = useMutation({
    mutationFn: async (token: string) => {
      const accessToken = await getAccessTokenSilently();
      return apiPost('/invite/reject', accessToken, { token });
    }
  });

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
    setInvites(invites.filter(invite => invite.token != token));
    setSuccessMessage('Great! You are now part of the same account and have a shared set of recipes.');
  }

  function handleReject(token: string) {
    rejectMutation.mutate(token);
    setInvites(invites.filter(invite => invite.token != token));
  }

  function handleInvite() {
    inviteMutation.mutate(invitee);
    setSuccessMessage(`An invite is on its way to ${invitee}`);
    setInvitee('');
  }

  return (
    <Layout>
      <MainContent name="Shopping List">
        <h1>Hi {user?.name}! You can use this page to customize your account.</h1>
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
              <Button style="primary" icon="tick" onClick={handleInvite}>Invite</Button>
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
