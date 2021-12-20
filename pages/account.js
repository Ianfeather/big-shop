import styles from './index.module.css';
import useFetch from 'use-http'
import { useState, useEffect } from 'react';
import Invite from '@components/invite';
import { useAuth0 } from "@auth0/auth0-react";
import Layout, { MainContent, Sidebar } from '@components/layout'
import Button from '@components/button';

const List = () => {
  let [invites, setInvites] = useState([]);
  let [invitee, setInvitee] = useState('');
  let [successMessage, setSuccessMessage] = useState(false);
  const { user } = useAuth0();
  const { get, post, patch, del, response } = useFetch(process.env.NEXT_PUBLIC_API_HOST, {
    cachePolicy: 'no-cache'
  });

  // TODO: Error handling
  async function handleAccept(token) {
    // Next steps:
    // add user menu
    post('/invite/accept', { token });
    setInvites(invites.filter(invite => invite.token != token));
    setSuccessMessage('Great! You are now part of the same account and have a shared set of recipes.');
  }

  async function handleReject(token) {
    post('/invite/reject', { token });
    setInvites(invites.filter(invite => invite.token != token));
  }

  async function handleInvite() {
    post('/invite', { email: invitee });
    setSuccessMessage(`An invite is on its way to ${invitee}`);
    setInvitee('');
  }

  async function fetchInvites() {
    const result = await get('/invites');
    if (response.ok && result.length) {
      setInvites(result);
    }
  }
  useEffect(() => { fetchInvites() }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Layout>
      <MainContent name="Shopping List">
        <h1>{user.email}</h1>
        <div className={styles.accountModule}>
          { !!invites.length && (
            <>
              <h2>You've been invited to join another user's account</h2>
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
          )}
          <h3>Invite someone to share your account.</h3>
          <div>
            <input type="text" value={invitee} onChange={(e) => setInvitee(e.target.value)} />
            <Button style="green" icon="tick" onClick={handleInvite}>Invite</Button>
          </div>
          { successMessage && (
            <h3>{successMessage}</h3>
          )}
        </div>
      </MainContent>
    </Layout>
  )
}

export default List
