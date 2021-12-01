import { useAuth0 } from "@auth0/auth0-react";

const Logout = ({ className }) => {
  const { logout } = useAuth0();
  return (
    <button
      className={className}
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
