import useAuth0 from '@hooks/use-auth';
import { appOrigin } from '../../../lib/app-origin';
import styles from '../index.module.css';

interface LogoutProps {
  className?: string;
}

const Logout = ({ className }: LogoutProps) => {
  const { logout } = useAuth0();
  return (
    <button
      className={`${styles.pointer} ${className}`}
      onClick={() =>
        logout({
          logoutParams: {
            // Where we are, not where the build was configured to think it is -
            // otherwise signing out of a deploy preview lands on production
            // (follow-ups.md #48). Auth0's Allowed Logout URLs must list it.
            returnTo: appOrigin(),
          },
        })
      }
    >
      Sign out
    </button>
  );
}

export default Logout;
