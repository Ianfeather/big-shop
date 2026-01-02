import './styles.css'
import { Auth0Provider, useAuth0 } from "@auth0/auth0-react";
import { Provider as FetchProvider } from 'use-http';
import { useRouter } from 'next/router';
import { useEffect } from 'react';

const InnerApp = ({ Component, pageProps }) => {
  const { isAuthenticated, isLoading, getAccessTokenSilently } = useAuth0();
  const router = useRouter();

  const fetchOptions = {
    interceptors: {
      request: async ({ options }) => {
        const token = await getAccessTokenSilently();
        options.headers.Authorization = `Bearer ${token}`
        return options
      }
    }
  };

  useEffect(() => {
    if (!isAuthenticated && !isLoading) {
      router.push('/');
    }
  }, [isAuthenticated, router, isLoading]);

  if (isLoading || !isAuthenticated) {
    return false;
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
  
  // Check if auth is disabled in local development
  const authDisabled = process.env.DISABLE_AUTH === 'true';
  const behindAuth = !authDisabled && router.route !== '/';

  return (
    <Auth0Provider
      domain={domain}
      clientId={clientId}
      audience={audience}
      redirectUri={process.env.NEXT_PUBLIC_HOST}
      useRefreshTokens={true}
      cacheLocation="localstorage"
    >
      {behindAuth ? (
        <InnerApp Component={Component} pageProps={pageProps} />
      ) : (
        <Component {...pageProps} />
      )}
    </Auth0Provider>
  )
}
