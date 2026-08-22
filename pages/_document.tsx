import { Html, Head, Main, NextScript } from 'next/document';
import { authDisabled } from '@hooks/use-auth';

// This file exists for one script, and the script exists because `/` is
// statically pre-rendered.
//
// The homepage HTML is built at deploy time and served from Netlify's CDN, so
// it paints long before React hydrates and long before the Auth0 SDK has
// decided who anyone is. Nothing done inside a component can change what that
// first paint shows - by the time any hook runs, the visitor has already seen
// it. That is why follow-ups.md #58's "read the SDK cache synchronously" idea
// does not actually work from inside `pages/index.tsx`: it moves the seam
// earlier without removing it.
//
// A blocking inline script in <head> is the one thing that runs before the
// body is painted. It cannot know the answer - only the SDK can, and only after
// it has talked to Auth0 - but it can make an informed guess from what the SDK
// has already written to this browser, and stamp it on <html> where CSS can
// act on it. `pages/index.tsx` overwrites the stamp with the real answer as
// soon as there is one.
//
// A guess is acceptable here precisely because of what rides on it: which of
// two header buttons is visible. Guess wrong and one button settles a moment
// later. That is a much smaller thing to be wrong about than a redirect or a
// blanked page, which is what made this approach worth taking at all.
//
// Three states, and the default matters most:
//
//   (unset)     Show "Log in". The static HTML is cached in this state, and it
//               is the correct one for every anonymous visitor - who are the
//               entire audience for this page. If the script throws, if JS is
//               off, if the SDK changes where it stores things, this is what
//               happens, and it is exactly today's behaviour.
//   in          Show "Your shopping list" instead.
//
// There used to be a third, 'returning', for the moment between Auth0's
// callback and the redirect onward to /list. Auth0 now returns straight to
// /list (lib/app-origin.ts), so nobody is ever mid-flight on this page and the
// state had nothing left to describe.
const authHintScript = (clientId: string) => `
(function () {
  try {
    var el = document.documentElement;
    var id = ${JSON.stringify(clientId)};
    // Both signals below are Auth0's own storage, read rather than relied on.
    // The cookie is the cheaper check and the more stable name - the SDK
    // documents it under sessionCheckExpiryDays and heeds it in checkSession -
    // but it expires after a day, which is shorter than the refresh-token
    // session, so the cache prefix is checked after it as the longer-lived
    // half. @@auth0spajs@@ is exported as CACHE_KEY_PREFIX by the installed
    // auth0-spa-js; lib/auth-hint.test.ts pins both against the real package.
    if (document.cookie.indexOf('auth0.' + id + '.is.authenticated=true') > -1) {
      el.setAttribute('data-auth', 'in');
      return;
    }
    var prefix = '@@auth0spajs@@::' + id;
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (key && key.slice(0, prefix.length) === prefix) {
        el.setAttribute('data-auth', 'in');
        return;
      }
    }
  } catch (e) {
    // Deliberately silent, and deliberately total. localStorage throws outright
    // in some privacy modes, and the honest answer to "can I tell?" there is
    // no - which leaves the unset default, i.e. the marketing page. A homepage
    // must never fail to render because a hint could not be computed.
  }
})();
`;

export default function Document() {
  // No Auth0 in this build means no Auth0 storage to read, so the script would
  // only ever fall through to its default. Local dev and the e2e suite run
  // this way (NEXT_PUBLIC_DISABLE_AUTH), where useAuth returns a fixed mock
  // user and index.tsx's own effect stamps the truth immediately.
  const clientId = authDisabled ? undefined : process.env.NEXT_PUBLIC_AUTH0_CLIENT_ID;

  return (
    <Html lang="en">
      <Head>
        {clientId && (
          <script dangerouslySetInnerHTML={{ __html: authHintScript(clientId) }} />
        )}
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
