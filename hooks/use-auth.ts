import { useAuth0 } from '@auth0/auth0-react';

export const authDisabled = process.env.NEXT_PUBLIC_DISABLE_AUTH === 'true';

const mockUser = {
  sub: 'local-dev-user',
  name: 'Local Dev',
  email: 'dev@localhost',
};

const useMockAuth0 = () => ({
  isAuthenticated: true,
  isLoading: false,
  user: mockUser,
  loginWithRedirect: () => {},
  logout: () => {},
  getAccessTokenSilently: async () => 'local-dev-token',
});

// Every consumer in this codebase only reaches for this subset of Auth0's
// real (much larger) context shape. Declaring it explicitly — rather than
// `as`-casting the ternary result — lets TypeScript actually check that both
// the real useAuth0 and the mock satisfy it, instead of just trusting it.
interface UseAuthResult {
  isAuthenticated: boolean;
  isLoading: boolean;
  user?: { sub?: string; name?: string; email?: string };
  loginWithRedirect: () => void;
  logout: () => void;
  getAccessTokenSilently: () => Promise<string>;
}

const useAuth: () => UseAuthResult = authDisabled ? useMockAuth0 : useAuth0;

export default useAuth;
