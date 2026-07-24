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
// real (much larger) context shape, so the export is narrowed to exactly
// that — letting the mock branch above satisfy the same type as the real
// useAuth0 without having to fake every field Auth0 exposes.
export default (authDisabled ? useMockAuth0 : useAuth0) as typeof useMockAuth0;
