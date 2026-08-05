import './styles.css'
import 'swagger-ui-react/swagger-ui.css'
import type { AppProps } from 'next/app';
import { Auth0Provider } from "@auth0/auth0-react";
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import useAuth0, { authDisabled } from '@hooks/use-auth';
import { requireEnv } from '../lib/env';

const InnerApp = ({ Component, pageProps }: Pick<AppProps, 'Component' | 'pageProps'>) => {
  const { isAuthenticated, isLoading } = useAuth0();
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated && !isLoading) {
      router.push('/');
    }
  }, [isAuthenticated, router, isLoading]);

  if (isLoading || !isAuthenticated) {
    return false;
  }

  return <Component {...pageProps} />;
}

export default function App({ Component, pageProps, router }: AppProps) {
  // '/' is the only route a logged-out visitor may see - it's the marketing
  // homepage. Everything else renders through InnerApp, which bounces them
  // back to it.
  const behindAuth = router.route !== '/';

  // Created once per app instance (not per render) - every hooks/use-*.ts
  // query and useMutation call site reads/writes via this client (see
  // follow-ups.md #20). Each hook fetches its own auth token rather than
  // relying on a shared request interceptor (use-http's old FetchProvider,
  // now removed).
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { refetchOnWindowFocus: false } }
  }));

  const content = behindAuth ? (
    <InnerApp Component={Component} pageProps={pageProps} />
  ) : (
    <Component {...pageProps} />
  );

  const wrappedContent = (
    <QueryClientProvider client={queryClient}>
      {content}
    </QueryClientProvider>
  );

  // With auth disabled, useAuth0() resolves to a fixed mock user rather than
  // talking to Auth0, so there's no need to mount the real provider - or
  // validate its env vars - at all.
  if (authDisabled) {
    return wrappedContent;
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
      // SDK v2 moved the values that end up as query params on the /authorize
      // call into this nested object, and renamed redirectUri to redirect_uri
      // to match the wire format. domain/clientId/useRefreshTokens/
      // cacheLocation stay top-level - they configure the client, not the
      // authorize request.
      authorizationParams={{
        audience,
        redirect_uri: process.env.NEXT_PUBLIC_HOST
      }}
      useRefreshTokens={true}
      cacheLocation="localstorage"
    >
      {wrappedContent}
    </Auth0Provider>
  )
}
