import './styles.css'
import { Auth0Provider, useAuth0 } from "@auth0/auth0-react";
import Login from '@components/identity/login';

const  InnerApp = ({ Component, pageProps }) => {
  const { isAuthenticated, isLoading } = useAuth0();
  if (isLoading) {
    return false;
  }
  if (!isAuthenticated) {
    return <Login />
  }
  return <Component {...pageProps} />
}

export default function App({ Component, pageProps }) {
  const domain = process.env.NEXT_PUBLIC_AUTH0_DOMAIN;
  const clientId = process.env.NEXT_PUBLIC_AUTH0_CLIENT_ID;

  return (
    <Auth0Provider
      domain={domain}
      clientId={clientId}
      redirectUri='http://localhost:3000'>
        <InnerApp Component={Component} pageProps={pageProps} />
    </Auth0Provider>
  )
}
