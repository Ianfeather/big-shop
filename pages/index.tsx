import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useMutation } from '@tanstack/react-query';
import styles from './index.module.css';
import Button from '@components/button'
import Layout, { MainContent } from '@components/layout'
import useAuth0 from '@hooks/use-auth';
import { apiPost, apiPatch } from '../lib/api-client';
import { LoginButton } from '@components/identity/login';
import { CreateAccountButton } from '@components/identity/create';
import type { User } from '../types/models';


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
  const { isAuthenticated, isLoading, user, getAccessTokenSilently } = useAuth0();
  const router = useRouter();
  // null while we're still checking onboarded status - kept blank rather than
  // flashing the marketing copy at an already-onboarded user who's about to be
  // redirected to /list.
  const [status, setStatus] = useState<'onboarding' | 'redirecting' | null>(null);

  const saveUserMutation = useMutation({
    mutationFn: async (payload: { name?: string; email?: string }) => {
      const token = await getAccessTokenSilently();
      return apiPost<User>('/user', token, payload);
    }
  });

  const completeOnboardingMutation = useMutation({
    mutationFn: async () => {
      const token = await getAccessTokenSilently();
      return apiPatch('/user/onboarding', token);
    }
  });

  useEffect(() => {
    if (isLoading || !isAuthenticated) return;

    async function resolveOnboarding() {
      if (!user) return;
      const { name, email } = user;
      const saved = await saveUserMutation.mutateAsync({ name, email }).catch(() => undefined);
      if (saved?.onboarded) {
        setStatus('redirecting');
        router.replace('/list');
        return;
      }
      // First-time user: show the onboarding screen once, and mark them
      // onboarded in the background so their next login skips straight to /list.
      setStatus('onboarding');
      completeOnboardingMutation.mutate();
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
