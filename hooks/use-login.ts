import useAuth0 from '@hooks/use-auth';

// The redirect params behind the Log In / Get started buttons, in one place so
// the marketing pages can style their own buttons without each re-deriving
// (and eventually mis-deriving) the Auth0 call. `components/identity`'s
// LoginButton/CreateAccountButton are the same two calls wearing the app's
// standard Button; these pages want their own.
export default function useLogin() {
  const { loginWithRedirect } = useAuth0();

  const logIn = () => loginWithRedirect({
    authorizationParams: {
      redirect_uri: process.env.NEXT_PUBLIC_HOST
    }
  });

  const signUp = () => loginWithRedirect({
    authorizationParams: {
      screen_hint: 'signup',
      redirect_uri: process.env.NEXT_PUBLIC_HOST
    }
  });

  return { logIn, signUp };
}
