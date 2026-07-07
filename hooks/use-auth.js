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

// When NEXT_PUBLIC_DISABLE_AUTH=true, every consumer gets a fixed "logged in"
// user instead of talking to Auth0, so local dev never hits the login screen.
export default authDisabled ? useMockAuth0 : useAuth0;
