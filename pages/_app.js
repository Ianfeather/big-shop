import './styles.css'
import { Auth0Provider } from "@auth0/auth0-react";
import { Provider as FetchProvider } from 'use-http';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import useAuth0, { authDisabled } from '@hooks/use-auth';

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

  const behindAuth = router.route !== '/';

  const content = behindAuth ? (
    <InnerApp Component={Component} pageProps={pageProps} />
  ) : (
    <Component {...pageProps} />
  );

  // With auth disabled, useAuth0() resolves to a fixed mock user rather than
  // talking to Auth0, so there's no need to mount the real provider at all.
  if (authDisabled) {
    return content;
  }

  return (
    <Auth0Provider
      domain={domain}
      clientId={clientId}
      audience={audience}
      redirectUri={process.env.NEXT_PUBLIC_HOST}
      useRefreshTokens={true}
      cacheLocation="localstorage"
    >
      {content}
    </Auth0Provider>
  )
}
