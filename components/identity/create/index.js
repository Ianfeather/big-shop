import useAuth0 from '@hooks/use-auth';
import Button from '../../button';
import styles from '../index.module.css';

export const CreateAccountButton = () => {
  const { loginWithRedirect } = useAuth0();

  const handleClick = () => {
    localStorage.setItem('app_state', 'login');
    loginWithRedirect({
      screen_hint: 'signup',
      redirectUri: `${process.env.NEXT_PUBLIC_HOST}/list`
    });
  }

  return (
    <Button
      style='pink'
      outline='true'
      className={styles.authButton}
      onClick={() => handleClick()}
    >
      Sign Up
    </Button>
  );
};

export default CreateAccountButton;
