import styles from './index.module.css';
import useFetch from 'use-http'
import { useState, useEffect } from 'react';
import Invite from '@components/invite';
import { useAuth0 } from "@auth0/auth0-react";
import Layout, { MainContent, Sidebar } from '@components/layout'


const List = () => {
  let [invites, setInvites] = useState([]);
  const { user } = useAuth0();
  const { get, post, patch, del, response } = useFetch(process.env.NEXT_PUBLIC_API_HOST, {
    cachePolicy: 'no-cache'
  });

  async function handleAccept(token) {
    // Next steps:
    // tie these functions together with the back end
    // handle success states (setstate etc
    // test end to end
    // style it nicer
    // add user menu
    post('/invite/accept', { token });
  }

  async function handleReject(token) {
    // TODO: implement
    post('/invite/reject', { token });
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
        { !!invites.length && (
          <div className={styles.accountModule}>
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
          </div>
        )}
      </MainContent>
    </Layout>
  )
}

export default List
