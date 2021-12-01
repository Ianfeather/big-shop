import { useAuth0 } from "@auth0/auth0-react";
import Button from '../../button';
import styles from '../index.module.css';

export const CreateAccountButton = ({ destination }) => {
  const { loginWithRedirect } = useAuth0();
  let redirectOps = {};
  if (destination) {
    redirectOps.redirect_uri = `${process.env.NEXT_PUBLIC_HOST}${destination}`;
  }

  return (
    <Button
      style='pink'
      outline='true'
      className={styles.authButton}
      onClick={() =>
        loginWithRedirect({
          screen_hint: 'signup',
          redirectOps
        })
      }
    >
      Sign Up
    </Button>
  );
};

export default CreateAccountButton;
