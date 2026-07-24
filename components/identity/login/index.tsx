import useAuth0 from '@hooks/use-auth';
import Button from '../../button';
import styles from '../index.module.css';

export const LoginButton = () => {
  const { loginWithRedirect } = useAuth0();

  const handleClick = () => {
    loginWithRedirect({
      redirectUri: process.env.NEXT_PUBLIC_HOST
    });
  }

  return (
    <Button className={styles.authButton} style='primary' onClick={() => handleClick()}>Log In</Button>
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
