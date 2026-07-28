import useAuth0 from '@hooks/use-auth';
import Button from '../../button';
import styles from '../index.module.css';

export const CreateAccountButton = () => {
  const { loginWithRedirect } = useAuth0();

  const handleClick = () => {
    loginWithRedirect({
      authorizationParams: {
        screen_hint: 'signup',
        redirect_uri: process.env.NEXT_PUBLIC_HOST
      }
    });
  }

  return (
    <Button
      style='primary'
      outline={true}
      className={styles.authButton}
      onClick={() => handleClick()}
    >
      Sign Up
    </Button>
  );
};

export default CreateAccountButton;
