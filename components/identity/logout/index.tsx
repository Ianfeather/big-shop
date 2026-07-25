import useAuth0 from '@hooks/use-auth';
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
          returnTo: process.env.NEXT_PUBLIC_HOST,
        })
      }
    >
      Sign out
    </button>
  );
}

export default Logout;
