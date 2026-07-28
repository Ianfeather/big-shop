import { useAuth0, RedirectLoginOptions, LogoutOptions } from '@auth0/auth0-react';

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
  loginWithRedirect: async () => {},
  logout: async () => {},
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
  // Both return Promise<void> in the real SDK. The interface said `void`,
  // which type-checked only because `void` swallows a promise - so no caller
  // could await a login or logout without the type lying to them. Shaped to
  // the SDK now, with the mock returning promises to match.
  loginWithRedirect: (options?: RedirectLoginOptions) => Promise<void>;
  logout: (options?: LogoutOptions) => Promise<void>;
  getAccessTokenSilently: () => Promise<string>;
}

const useAuth: () => UseAuthResult = authDisabled ? useMockAuth0 : useAuth0;

export default useAuth;
