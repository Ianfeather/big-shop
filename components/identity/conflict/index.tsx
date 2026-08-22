import Head from 'next/head';
import Logout from '@components/identity/logout';
import { SUPPORT_EMAIL } from '../../../lib/contact';
import styles from './index.module.css';

// What somebody sees when they sign in with a provider Big Shop has not seen
// them use before, on an email address that already has an Account under a
// different one.
//
// **This screen is a data-loss alarm wearing an apology.** Without it that same
// login silently produces a brand-new, empty Account (see the Go side's
// service.ConflictingUserID): the person is signed in, the app works, and every
// recipe they have ever saved appears to be gone. There is no error state in
// that version - which is exactly what makes it the worst outcome the login
// change can produce, and why this is a full-page interruption rather than a
// toast. Letting them through to a working-looking empty app is the failure.
//
// So the copy has one job, and it is not to apologise: it has to say *nothing
// is lost* before it says anything else, because that is the question the
// person is already asking by the time they read it.
//
// **It cannot name the provider they used originally**, which is the obvious
// thing to want here and would make the instruction concrete. The server knows,
// and deliberately does not send it: the email it matched on arrives in the
// request body rather than from a verified token, so echoing back "that address
// is a Google account" turns POST /user into an account-enumeration oracle for
// anyone with a token. That constraint is a consequence of the address not
// being verified server-side, not of anything about this screen - see the note
// in app/user.go for what would lift it.
//
// Sign out is the only action, and it has to be here rather than left to the
// header, because the header is part of the app shell this screen replaces.
// Without it the person is stuck: they are authenticated as the identity that
// cannot proceed, and reloading returns them to this same page forever.
const IdentityConflict = () => (
  <>
    <Head>
      <title>Sign in a different way &mdash; Big Shop</title>
      <meta name="robots" content="noindex" />
    </Head>

    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>Almost there</p>
        <h1 className={styles.heading}>Your recipes are safe.</h1>
        <p className={styles.body}>
          This email address already has a Big Shop account, but it was set up
          with a different sign-in method. Signing in this way would start you
          off with an empty account, so we stopped before that happened.
        </p>
        <p className={styles.body}>
          Sign out, then sign back in using the method you used when you first
          joined and everything will be where you left it.
        </p>

        {/* Logout renders its own <button>, so it is styled here rather than
            wrapped in @components/button - nesting one button inside another
            is invalid markup and browsers resolve it in their own ways. */}
        <Logout className={styles.action} />

        <p className={styles.footnote}>
          Not sure which one you used? Email{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and we will
          sort it out.
        </p>
      </div>
    </main>
  </>
);

export default IdentityConflict;
