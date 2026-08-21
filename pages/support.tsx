import Head from 'next/head';
import Link from 'next/link';
import styles from './support.module.css';
import Logo from '@components/svg/logo';
import { useCookieSettings } from '@components/consent-banner';
import { SUPPORT_EMAIL } from '../lib/contact';

// Support. A public page, reachable logged-out from the marketing footer, so it
// is built on the same "Cookbook" furniture as pages/index.tsx and
// pages/privacy.tsx - paper, ink, claret headings, the grain overlay - rather
// than on components/layout, whose Header is app chrome for a signed-in user.
//
// **Public deliberately, and it is the whole point of the page.** Someone who
// cannot log in is exactly the person most likely to need this, and a support
// page behind the login gate is unreachable by the audience it exists for. That
// is the same argument /privacy needed, and it has the same two halves: the
// route is listed in pages/_app.tsx's `publicRoutes`, *and* it is linked from
// the logged-out footer. Either one alone leaves the page stranded.
//
// There is no contact form, and that is a choice rather than a shortcut. A form
// needs an endpoint, spam handling, and somewhere for the message to land -
// three things to keep working - to arrive at the same inbox a mailto: reaches
// directly. It also strands anyone whose problem is that the app is broken.

export default function Support() {
  const openCookieSettings = useCookieSettings();

  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta charSet="utf-8" />
        <meta name="description" content="How to get help with Big Shop: email hello@bigshop.life with any question, problem or suggestion." />
        <meta name="theme-color" content="#faf5ee" />
        <title>Support &mdash; Big Shop</title>
        <link rel="shortcut icon" crossOrigin="" href="/favicon.ico" type="image/x-icon" />
      </Head>

      <div className={styles.page}>
        <div className={styles.grain} aria-hidden="true" />

        <header className={styles.header}>
          <Link className={styles.brand} href="/">
            <Logo className={styles.mark} />
            <span className={styles.wordmark}>Big Shop</span>
          </Link>
          <Link href="/" className={styles.back}>Back to the homepage</Link>
        </header>

        <main className={styles.main}>
          <p className={styles.eyebrow}>Support</p>
          <h1 className={styles.display}>Stuck, or got something to say?</h1>
          <p className={styles.standfirst}>
            There is one way to reach us and it is an email address. Questions, feedback and
            anything that looks broken all go to the same place.
          </p>

          <div className={styles.card}>
            <p className={styles.cardLabel}>Email us</p>
            <a className={styles.email} href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          </div>

          <section className={styles.section}>
            <p>Write about anything:</p>
            <ul className={styles.list}>
              <li>
                <strong>A question.</strong>{' '}How something is meant to work, or whether Big Shop
                can do the thing you are trying to do.
              </li>
              <li>
                <strong>Feedback.</strong>{' '}What is annoying, what is missing, what you would
                change. Big Shop is small enough that this genuinely decides what gets built next.
              </li>
              <li>
                <strong>Something broken.</strong>{' '}An error, a recipe that would not import, a
                shopping list that came out wrong.
              </li>
            </ul>
            <p className={styles.note}>
              If it is something broken, telling us what you were doing and roughly when saves a
              round trip &mdash; it is usually enough to find the error on our side.
            </p>
          </section>

          <section className={styles.section}>
            <p>
              Asking for a copy of your data, a correction, or deletion is covered on the{' '}
              <Link href="/privacy">privacy page</Link>, which says what happens in each case.
              Deleting your account has a button on your account page and does not need an email.
            </p>
          </section>
        </main>

        <footer className={styles.footer}>
          <Logo className={styles.footerMark} />
          <p>Big Shop &mdash; recipes in, shopping list out.</p>
          <nav className={styles.footerLinks}>
            <Link href="/privacy">Privacy</Link>
            <button type="button" onClick={openCookieSettings}>Cookie settings</button>
          </nav>
        </footer>
      </div>
    </>
  );
}
