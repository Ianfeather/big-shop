import Head from 'next/head';
import Link from 'next/link';
import styles from './error.module.css';
import Logo from '@components/svg/logo';
import { useCookieSettings } from '@components/consent-banner';
import { SUPPORT_EMAIL } from '../lib/contact';

// The generic "something went wrong" page, and the tenant-level error page Auth0
// is pointed at. Public for the same reason as /support and more urgently: the
// person who lands here has, by definition, just failed to get through the login
// they would need to see a gated page. It is listed in pages/_app.tsx's
// publicRoutes.
//
// **Not linked from anywhere**, unlike /support. It is a destination other
// systems send people to, not somewhere anyone navigates on purpose, so it stays
// out of the marketing footer. `noindex` for the same reason - an error page in
// search results is a bad answer to every query it could match.
//
// **It deliberately does not render Auth0's error detail.** Auth0 appends
// `error` and `error_description` to this URL, and echoing `error_description`
// would put attacker-influenceable text from a query string onto the page, to
// say something like "invalid_request" that means nothing to the person reading
// it. The apology and the address are more useful and carry no such question.
// If a future version does want the detail, it belongs in a place a human never
// reads - a telemetry attribute - and not in the copy.

export default function ErrorPage() {
  const openCookieSettings = useCookieSettings();

  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta charSet="utf-8" />
        <meta name="robots" content="noindex" />
        <meta name="description" content="Something went wrong in Big Shop." />
        <meta name="theme-color" content="#faf5ee" />
        <title>Something went wrong &mdash; Big Shop</title>
        <link rel="shortcut icon" crossOrigin="" href="/favicon.ico" type="image/x-icon" />
      </Head>

      <div className={styles.page}>
        <div className={styles.grain} aria-hidden="true" />

        <header className={styles.header}>
          <Link className={styles.brand} href="/">
            <Logo className={styles.mark} />
            <span className={styles.wordmark}>Big Shop</span>
          </Link>
          <Link href="/support" className={styles.back}>Get help</Link>
        </header>

        <main className={styles.main}>
          <p className={styles.eyebrow}>Error</p>
          <h1 className={styles.display}>Something broke there.</h1>
          <p className={styles.body}>
            Our apologies. Please try again, or email{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> if it persists.
          </p>
          <Link href="/" className={styles.action}>Back to the homepage</Link>
        </main>

        <footer className={styles.footer}>
          <Logo className={styles.footerMark} />
          <p>Big Shop &mdash; recipes in, shopping list out.</p>
          <nav className={styles.footerLinks}>
            <Link href="/support">Support</Link>
            <Link href="/privacy">Privacy</Link>
            <button type="button" onClick={openCookieSettings}>Cookie settings</button>
          </nav>
        </footer>
      </div>
    </>
  );
}
