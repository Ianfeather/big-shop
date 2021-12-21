import './styles.css'
import { Auth0Provider, useAuth0 } from "@auth0/auth0-react";
import Login from '@components/identity/login';
import { Provider as FetchProvider } from 'use-http';


const  InnerApp = ({ Component, pageProps }) => {
  const { isAuthenticated, isLoading, getAccessTokenSilently } = useAuth0();

  const fetchOptions = {
    interceptors: {
      request: async ({ options }) => {
        const token = await getAccessTokenSilently();
        options.headers.Authorization = `Bearer ${token}`
        return options
      }
    }
  };

  if (isLoading) {
    return false;
  }
  if (!isAuthenticated) {
    // TODO: Redirect here instead of showing the form
    return <Login />
  }
  return (
    <FetchProvider url={process.env.NEXT_PUBLIC_API_HOST} options={fetchOptions}>
      <Component {...pageProps} />
    </FetchProvider>
  )
}

export default function App({ Component, pageProps, router }) {
  const domain = process.env.NEXT_PUBLIC_AUTH0_DOMAIN;
  const clientId = process.env.NEXT_PUBLIC_AUTH0_CLIENT_ID;
  const audience = process.env.NEXT_PUBLIC_AUTH0_AUDIENCE;
  const behindAuth = router.route !== '/';

  return (
    <Auth0Provider
      domain={domain}
      clientId={clientId}
      audience={audience}
      redirectUri={process.env.NEXT_PUBLIC_HOST}>
        {
          behindAuth ?
          <InnerApp Component={Component} pageProps={pageProps} /> :
          <Component />
        }
    </Auth0Provider>
  )
}
