import { useAuth0 } from "@auth0/auth0-react";
import Button from '../../button';
import styles from '../index.module.css';

export const LoginButton = ({destination}) => {
  let redirectOps = {};
  if (destination) {
    redirectOps.redirect_uri = `${process.env.NEXT_PUBLIC_HOST}${destination}`;
  }

  const { loginWithRedirect } = useAuth0();
  return (
    <Button className={styles.authButton} style='pink' onClick={() => loginWithRedirect(redirectOps)}>Log In</Button>
  );
};

const Login = () => {
  return (
    <div>
      <h1>Welcome to big shop</h1>
      <h2>Log in to get started</h2>
      <LoginButton />
    </div>
  )
}

export default Login;
