import { useAuth0 } from "@auth0/auth0-react";

const LoginButton = () => {
  const { loginWithRedirect } = useAuth0();
  return (
    <button onClick={() => loginWithRedirect()}>Log In</button>
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
