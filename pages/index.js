import styles from './index.module.css';
import Button from '@components/button'
import Layout, { MainContent } from '@components/layout'
import { useAuth0 } from "@auth0/auth0-react";
import { LoginButton } from '@components/identity/login';
import { CreateAccountButton } from '@components/identity/create';

const LoggedInState = () => (
  <Button type="link" href="/list">Go to shopping list</Button>
)

const LoggedOutState = () => (
  <>
  <LoginButton destination="/list" />
  <CreateAccountButton destination="/list" />
  </>
);

const Index = () => {
  const { isAuthenticated, isLoading } = useAuth0();

  return (
    <Layout>
      <MainContent name="Homepage" fullHeight={false}>
        <div className={styles.landingPage}>
          <h1 className={styles.landingHeading}>Welcome!</h1>
          <p className={styles.landingSubHeading}>Big Shop is the easiest way to keep track of your favourite recipes, avoid cooking the same meals on repeat, and quickly build your weekly shopping list.</p>
          {
            isLoading ? false :
              isAuthenticated ? <LoggedInState /> : <LoggedOutState />
          }
        </div>
      </MainContent>
    </Layout>
  )
}

export default Index
