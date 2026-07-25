import './styles.css'
import 'swagger-ui-react/swagger-ui.css'
import type { AppProps } from 'next/app';
import { Auth0Provider } from "@auth0/auth0-react";
import { Provider as FetchProvider, Interceptors } from 'use-http';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import useAuth0, { authDisabled } from '@hooks/use-auth';
import { requireEnv } from '../lib/env';

const InnerApp = ({ Component, pageProps }: Pick<AppProps, 'Component' | 'pageProps'>) => {
  const { isAuthenticated, isLoading, getAccessTokenSilently } = useAuth0();
  const router = useRouter();

  const fetchOptions: { interceptors: Interceptors } = {
    interceptors: {
      request: async ({ options }) => {
        const token = await getAccessTokenSilently();
        // use-http always passes a plain headers object here in practice,
        // not a Headers instance or a [string, string][] tuple array (the
        // other members of RequestInit['headers']'s union type).
        (options.headers as Record<string, string>).Authorization = `Bearer ${token}`
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

export default function App({ Component, pageProps, router }: AppProps) {
  const behindAuth = router.route !== '/';

  const content = behindAuth ? (
    <InnerApp Component={Component} pageProps={pageProps} />
  ) : (
    <Component {...pageProps} />
  );

  // With auth disabled, useAuth0() resolves to a fixed mock user rather than
  // talking to Auth0, so there's no need to mount the real provider - or
  // validate its env vars - at all.
  if (authDisabled) {
    return content;
  }

  // Only reached with authDisabled false, i.e. real Auth0 is required
  // (CLAUDE.md documents these as required env vars for the auth flow).
  // requireEnv fails fast with a clear error for a misconfigured deploy
  // (e.g. a preview deploy with auth enabled but no Auth0 vars set),
  // rather than a `!`-asserted undefined passing silently into Auth0Provider.
  const domain = requireEnv(process.env.NEXT_PUBLIC_AUTH0_DOMAIN, 'NEXT_PUBLIC_AUTH0_DOMAIN');
  const clientId = requireEnv(process.env.NEXT_PUBLIC_AUTH0_CLIENT_ID, 'NEXT_PUBLIC_AUTH0_CLIENT_ID');
  const audience = process.env.NEXT_PUBLIC_AUTH0_AUDIENCE;

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
