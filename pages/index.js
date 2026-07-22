import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import useFetch from 'use-http';
import styles from './index.module.css';
import Button from '@components/button'
import Layout, { MainContent } from '@components/layout'
import useAuth0 from '@hooks/use-auth';
import { LoginButton } from '@components/identity/login';
import { CreateAccountButton } from '@components/identity/create';

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === 'true';

const OnboardingState = () => (
  <Button type="link" href="/list" style="primary">Start building your shopping list</Button>
)

const LoggedOutState = () => (
  <>
    <LoginButton />
    <CreateAccountButton />
  </>
);

const Index = () => {
  const { isAuthenticated, isLoading, user } = useAuth0();
  const router = useRouter();
  // null while we're still checking onboarded status (or mocks bypass isn't
  // resolved yet) - kept blank rather than flashing the marketing copy at an
  // already-onboarded user who's about to be redirected to /list.
  const [status, setStatus] = useState(null); // null | 'onboarding' | 'redirecting'
  const { post, patch, response } = useFetch(process.env.NEXT_PUBLIC_API_HOST, {
    cachePolicy: 'no-cache'
  });

  useEffect(() => {
    if (isLoading || !isAuthenticated) return;

    if (useMocks) {
      setStatus('onboarding');
      return;
    }

    async function resolveOnboarding() {
      const { name, email } = user;
      const saved = await post('/user', { name, email });
      if (response.ok && saved && saved.onboarded) {
        setStatus('redirecting');
        router.replace('/list');
      } else {
        // First-time user: show the onboarding screen once, and mark them
        // onboarded in the background so their next login skips straight to /list.
        setStatus('onboarding');
        patch('/user/onboarding');
      }
    }
    resolveOnboarding();
  }, [isLoading, isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Layout>
      <MainContent name="Homepage" fullHeight={false}>
        <div className={styles.landingPage}>
          <h1 className={styles.landingHeading}>Welcome!</h1>
          <p className={styles.landingSubHeading}>Big Shop is the easiest way to keep track of your favourite recipes, avoid cooking the same meals on repeat, and quickly build your weekly shopping list.</p>
          {
            isLoading ? false :
              !isAuthenticated ? <LoggedOutState /> :
                status === 'onboarding' ? <OnboardingState /> : false
          }
        </div>
      </MainContent>
    </Layout>
  )
}

export default Index
