import './styles.css'
import 'swagger-ui-react/swagger-ui.css'
import type { AppProps } from 'next/app';
import { Auth0Provider } from "@auth0/auth0-react";
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import useAuth0, { authDisabled } from '@hooks/use-auth';
import { requireEnv } from '../lib/env';
import { appOrigin } from '../lib/app-origin';
import { identifyUser, setupFaro, setView } from '../lib/telemetry/faro';

// Started here rather than at module scope so it runs in the browser only, and
// once. _app.tsx is also rendered on the server, where there is no window for
// Faro's instrumentations to attach to.
//
// Deliberately *not* inside a component's effect: an effect runs after the
// first paint, and reactStrictMode double-invokes it in development, so errors
// thrown during initial render - the ones most worth catching - would happen
// before Faro was listening. This runs as soon as the module is evaluated on
// the client, which is the earliest point available in the pages router.
if (typeof window !== 'undefined') {
  setupFaro();
}

const InnerApp = ({ Component, pageProps }: Pick<AppProps, 'Component' | 'pageProps'>) => {
  const { isAuthenticated, isLoading, user } = useAuth0();
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated && !isLoading) {
      router.push('/');
    }
  }, [isAuthenticated, router, isLoading]);

  // The join ADR-0007 picks Faro for: this is the same Auth0 subject the Go API
  // puts on its spans as `user.sub`, so a browser session and the backend work
  // it caused are findable from each other. Set once the user resolves, since
  // before that there is nobody to name.
  useEffect(() => {
    identifyUser(user?.sub);
  }, [user?.sub]);

  if (isLoading || !isAuthenticated) {
    return false;
  }

  return <Component {...pageProps} />;
}

export default function App({ Component, pageProps, router }: AppProps) {
  // The route *template*, so errors group by page rather than scattering across
  // one view per recipe id - see setView's note on why the resolved path would
  // be both content and an unbounded label.
  useEffect(() => {
    setView(router.route);
  }, [router.route]);

  // The routes a logged-out visitor may see. Everything else renders through
  // InnerApp, which bounces them back to '/'.
  //
  // '/' is the marketing homepage and was for a long time the only entry here.
  // '/privacy' has to join it, and the reason is worth stating because the
  // failure mode is silent: the privacy policy is linked from the *logged-out*
  // marketing footer, so leaving it behind the gate means the one audience it
  // exists for - someone deciding whether to trust the product with their data,
  // before they have an account - is redirected away from it. Nothing errors;
  // they just land back on the homepage and never see the page.
  //
  // It is also invisible in local development, which is how it was missed the
  // first time: NEXT_PUBLIC_DISABLE_AUTH makes hooks/use-auth.ts's mock report
  // `isAuthenticated: true` unconditionally, so the gate never fires and the
  // page appears to work.
  const publicRoutes = ['/', '/privacy'];
  const behindAuth = !publicRoutes.includes(router.route);

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
      // redirect_uri is the origin we are actually being served from, not the
      // build-time NEXT_PUBLIC_HOST - otherwise a deploy preview sends the user
      // to production to finish logging in (follow-ups.md #48). Auth0 still has
      // to allow whatever origin this resolves to; see lib/app-origin.ts and
      // docs/deploy-previews.md.
      authorizationParams={{
        audience,
        redirect_uri: appOrigin()
      }}
      useRefreshTokens={true}
      cacheLocation="localstorage"
    >
      {wrappedContent}
    </Auth0Provider>
  )
}
