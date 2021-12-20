import { useAuth0 } from "@auth0/auth0-react";
import styles from '../index.module.css';

const Logout = ({ className }) => {
  const { logout } = useAuth0();
  return (
    <button
      className={`${styles.pointer} ${className}`}
      onClick={() =>
        logout({
          returnTo: process.env.NEXT_PUBLIC_HOST,
        })
      }
    >
      Sign out
    </button>
  );
}

export default Logout;
