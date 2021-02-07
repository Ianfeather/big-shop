import { useAuth0 } from "@auth0/auth0-react";

const Logout = () => {
  const { logout } = useAuth0();
  return (
    <button
      className="btn btn-danger btn-block"
      onClick={() =>
        logout({
          returnTo: process.env.NEXT_PUBLIC_HOST,
        })
      }
    >
      Log Out
    </button>
  );
}

export default Logout;
