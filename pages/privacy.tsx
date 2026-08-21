import Head from 'next/head';
import Link from 'next/link';
import styles from './privacy.module.css';
import Logo from '@components/svg/logo';
import { POLICY_VERSION, policyLastUpdated } from '../lib/consent';
import { useCookieSettings } from '@components/consent-banner';
import { enabled as analyticsConfigured } from '../lib/analytics/ga';

// The privacy policy. A public page, reachable logged-out from the marketing
// footer, so it is built on the same "Cookbook" furniture as pages/index.tsx -
// paper, ink, claret headings, the grain overlay - rather than on
// components/layout, whose Header is app chrome for a signed-in user.
//
// Written in the same register as the rest of the app: plain, unexcited,
// concrete. That is not a style preference here so much as the point. A policy
// assembled out of template clauses describes a generic web app, and this one
// has to describe *this* system - an LLM reads the recipes you import, error
// reporting is deliberately not consent-gated, and the API and database sit in
// Frankfurt while the import endpoints run in Ohio. None of that survives a
// generator.
//
// **The content is the deliverable, not the layout.** Anything below that
// stops being true - a processor added or dropped, a new category of data, a
// new purpose - is a change to make here *and* a reason to bump POLICY_VERSION
// in lib/consent.ts.
//
// That cuts both ways, and it is the trap this page fell into once already: it
// was first written describing the *finished* feature, so it explained the
// analytics Big Shop would collect and pointed at a "Cookie settings" control,
// neither of which existed yet. A privacy policy that describes processing that
// is not happening, and directs people to a control that is not there, is worse
// than one that is merely incomplete - it is the page nobody should have to
// double-check. **Describe what ships with it, not what is planned.**

const CONTACT_EMAIL = 'info@ianfeather.co.uk';

// Whether analytics is switched on for this build at all. Read here, rather
// than assumed, because it is what stops this page going stale in the one
// direction it keeps going stale in.
//
// **This page has twice claimed a feature that was not live**, both times
// caught in review rather than by anyone reading it. Analytics ships dark - the
// code is present and the measurement id is not - so a page that flatly says
// "Big Shop uses Google Analytics" would be false on the day it is published
// and true some weeks later, with nothing in between to prompt an edit. Keying
// the wording to the same switch the code uses means neither state can be
// described wrongly, and nobody has to remember.
const ANALYTICS_LIVE = analyticsConfigured();

// Who else processes data, why, and where. Assembled by tracing the code
// rather than from a template: ADR-0006 places the API on Fly in `fra` and
// records that Netlify's functions default to `cmh` (US East, Ohio) with
// region selection paywalled, which is why the two rows differ. ADR-0007 puts
// Grafana Cloud in eu-central-1, and ADR-0008 is the authority on what the
// telemetry rows do and do not carry.
const processors = [
  {
    name: 'Auth0 (Okta)',
    purpose: 'Logging you in, and holding your email address and name.',
    where: 'EU',
  },
  {
    name: 'Netlify',
    purpose: 'Serving the site, and running the recipe-import and chat endpoints.',
    where: 'United States',
  },
  {
    name: 'Fly.io',
    purpose: 'Running the API that reads and writes your recipes and lists.',
    where: 'Frankfurt',
  },
  {
    name: 'TiDB Cloud',
    purpose: 'The database everything above is stored in.',
    where: 'Frankfurt (AWS eu-central-1)',
  },
  {
    name: 'Grafana Cloud',
    purpose: 'Error reporting and performance monitoring. See “Error reporting” below.',
    where: 'EU',
  },
  {
    name: 'OpenAI',
    purpose: 'Reading a recipe you import, and answering when you chat to Dave.',
    where: 'United States',
  },
  {
    name: 'SendGrid (Twilio)',
    purpose:
      'Sending the emails below \u2014 your first-fortnight emails, and an invite when you share your account. Also holds unsubscribes permanently.',
    where: 'United States',
  },
  ...(ANALYTICS_LIVE
    ? [
        {
          name: 'Google Analytics',
          purpose: 'Counting how the site is used \u2014 only if you accept. See \u201cAnalytics\u201d below.',
          where: 'United States',
        },
      ]
    : []),
];

// What is written to your own browser, which is the half of a privacy policy
// people can actually check. Enumerated from the code and confirmed against the
// running app rather than assumed - the surface is smaller than a typical app's
// because _app.tsx configures Auth0 with cacheLocation="localstorage", so the
// login session is browser storage rather than a cookie.
//
// The error-reporting row is the one that would have been missed by describing
// the app from memory. @grafana/faro-web-sdk writes a session id under
// `com.grafana.faro.session`, and because its defaultSessionTrackingConfig sets
// `persistent: false` it goes to sessionStorage via the VolatileSessionManager -
// so it is gone when the tab closes, and expires after four hours anyway. It is
// listed because it is real, and because leaving it out of the table while the
// section above explains that error reporting is not consent-gated would be
// exactly the kind of quiet omission that section exists to avoid.
const deviceStorage = [
  {
    what: 'Your login session',
    detail: 'Set by Auth0 so you stay logged in between visits. Cleared when you log out.',
  },
  {
    what: 'Your cookie choice',
    detail: 'Whether you accepted or declined analytics, and which version of this policy you decided against.',
  },
  {
    what: 'Shopping list layout',
    detail: 'Small display preferences, like whether the store-cupboard group is open.',
  },
  {
    what: 'An unfinished recipe',
    detail: 'If you start adding a recipe and navigate away, the draft is held so you do not lose it. Cleared once it is used.',
  },
  {
    what: 'An error-reporting session id',
    detail: 'A random id that ties several errors together into one visit. Kept for the tab only, and gone when you close it.',
  },
  ...(ANALYTICS_LIVE
    ? [
        {
          what: 'Google Analytics cookies',
          detail:
            'Only if you accept analytics. A random id for this browser and one for the current visit; removed again if you withdraw.',
        },
      ]
    : []),
];

export default function Privacy() {
  const openCookieSettings = useCookieSettings();

  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta charSet="utf-8" />
        <meta name="description" content="What Big Shop stores, who else sees it, and how to get it back or get rid of it." />
        <meta name="theme-color" content="#faf5ee" />
        <title>Privacy &mdash; Big Shop</title>
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
          <p className={styles.eyebrow}>Privacy</p>
          <h1 className={styles.display}>What we store, and who else sees it.</h1>
          <p className={styles.standfirst}>
            Big Shop is a recipe and shopping list app run by Ian Feather. This page says what it
            keeps, where that goes, and how to get it back or get rid of it. It is written to be
            read rather than to be complied with, so if anything here is unclear that is a fault
            worth telling us about.
          </p>
          <p className={styles.meta}>
            Last updated {policyLastUpdated()} &middot; version {POLICY_VERSION}
          </p>

          <section className={styles.section}>
            <h2 className={styles.heading}>What Big Shop stores</h2>
            {/*
              The `{' '}` after each </strong> is load-bearing, not a tic. A JSX
              text child that both spans several source lines *and* contains an
              HTML entity loses its leading space in the compiled output, so
              `<strong>Your recipes.</strong> Names,` renders as
              "Your recipes.Names,". Only the two items carrying an &mdash; were
              affected, which is what makes it easy to introduce by editing one
              bullet and easy to miss in review - the neighbouring bullets look
              identical and are fine. Written explicitly on every item so the
              next person to add an em dash doesn't reintroduce it.
              (follow-ups.md #47 asks for a pass over the marketing page's own
              &mdash; usage; this is the same class of defect.)
            */}
            <ul className={styles.list}>
              <li>
                <strong>Your account.</strong>{' '}The email address and name you signed up with, an
                identifier from our login provider, and when you last logged in.
              </li>
              <li>
                <strong>Your recipes.</strong>{' '}Names, ingredients, methods, notes, tags, and the
                link a recipe came from. If you import one by photographing it, the photo is sent
                away to be read and then deleted &mdash; it is never stored.
              </li>
              <li>
                <strong>Your shopping lists.</strong>{' '}What is on them, how much of each, and what
                you have ticked off &mdash; plus a record of lists you have made before, which is
                what lets Dave suggest from what you actually cook.
              </li>
              <li>
                <strong>Invites you send.</strong>{' '}Not the email address itself. When you invite
                someone, their address is scrambled into a fingerprint that cannot be turned back
                into an address, and only the fingerprint is stored &mdash; enough to show them the
                invite when they log in, and no use to anyone who got hold of the database. The
                invite is deleted when it is accepted or rejected, and expires after 30 days either
                way.
              </li>
              <li>
                <strong>A few preferences.</strong>{' '}Whether you have been shown the welcome screen,
                and how you like the shopping list laid out.
              </li>
              <li>
                <strong>Your timezone.</strong>{' '}The name of the timezone your browser reported when
                you signed up &mdash; &ldquo;Europe/London&rdquo;, for instance. It is recorded once,
                never updated, and used for one thing: sending the emails below at a reasonable hour
                where you are rather than where our servers are. It stays in our database and is not
                sent to anyone else.
              </li>
            </ul>
            <p>
              There is no advertising here, no profiling, and nothing is sold or shared with anyone
              beyond the companies listed below that run the thing.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.heading}>Recipes are shared with your account, not with the world</h2>
            <p>
              An account can have more than one person on it &mdash; that is the point of it. Anyone
              you share an account with can see and change every recipe and list on that account.
              Ingredient <em>names</em> are the one exception: they are pooled across everybody, so
              that “tin of chopped tomatoes” means the same thing for everyone. Your recipes are not.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.heading}>Reading recipes, and Dave</h2>
            <p>
              When you import a recipe from a link, a photo, or pasted text, the contents are sent to
              OpenAI to be turned into ingredients and a method.
            </p>
            <p>
              Dave sends more than you might assume, so it is worth being exact. To answer a
              question he can look up your recipes, read a whole recipe back &mdash; ingredients and
              method &mdash; and read the history of lists you have made. Whatever he looks up goes
              to OpenAI along with your messages. That is the feature working rather than a leak,
              but it means your recipes leave our systems when you chat to him, not just their names.
            </p>
            <p>
              OpenAI processes it on our behalf and, on the API terms Big Shop uses, does not train
              on it.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.heading}>Error reporting</h2>
            <p>
              Big Shop reports its own errors and performance to Grafana Cloud, and{' '}
              <strong>it is not something you are asked to consent to</strong>. We treat it as
              necessary to keep the service working, since an app that only reports errors for
              people who opted in is an app that does not know when it is broken. It is a deliberate
              choice rather than an oversight, and it is a contested one, so it is stated here
              rather than buried.
            </p>
            <p>
              What it carries is limited on purpose: an account number, a login identifier, page
              names, timings, and error messages. It does not carry your recipes, your ingredients,
              your chats with Dave, or your email address. It is deleted after 14 days.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.heading}>Analytics</h2>
            {!ANALYTICS_LIVE && (
              <p>
                <strong>Big Shop is not running any analytics at the moment.</strong>{' '}
                Nothing is counting what you do, and the only thing watching the app is the error
                reporting described above. The cookie banner asks anyway, because that is due to
                change and we would rather have your answer before anything starts than after.
                What follows is what your answer will mean.
              </p>
            )}
            <p>
              Analytics is the one thing here you get a say over, and it is off until you say
              otherwise.
            </p>
            <p>
              <strong>Decline and nothing loads.</strong>{' '}
              Not a reduced version, not a cookieless one, nothing at all &mdash; no script from
              Google is fetched and no request reaches them. That is stricter than the usual
              arrangement, where the tag loads for everyone and merely promises not to store
              anything.
            </p>
            <p>
              Accept and Big Shop {ANALYTICS_LIVE ? 'uses' : 'would use'} Google Analytics to
              count how the site is used: which pages get visited, and a short fixed list of
              actions like “a recipe was imported”. It is never told who you are. It gets a
              random identifier standing for your account, so that several visits from one
              household count as one household rather than several strangers &mdash; and it does
              not get your login identifier, your name, your email address, or the names of your
              recipes. Loading it does let Google see the usual things any website sees: your IP
              address, which page you came from, and what browser you are using. Advertising
              features are switched off permanently; Big Shop runs no ads.
            </p>
            <p>
              You can change your mind whenever you like, using the Cookie settings link at the
              bottom of this page. Withdrawing stops the collection there and then &mdash; no
              further page is counted &mdash; and deletes the cookies Google has already set.
            </p>
            <p className={styles.note}>
              <strong>What deleting your account does here, precisely.</strong>{' '}
              That random identifier is the only thing tying Google&rsquo;s copy of these counts to
              your account, and the table linking the two is kept here rather than by Google. When
              you delete your account, that link is destroyed. Being straight about the limits of
              that: it does not reach into Google and delete anything, and Google keeps its own
              cookie id and the rough location it works out from your IP address regardless. What
              it does mean is that nothing left in Google can be tied back to you or your account
              &mdash; by us or by anyone else.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.heading}>What is stored on your device</h2>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">What</th>
                    <th scope="col">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {deviceStorage.map(row => (
                    <tr key={row.what}>
                      <th scope="row">{row.what}</th>
                      <td>{row.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={styles.note}>
              {ANALYTICS_LIVE
                ? 'Everything above Google Analytics is needed for the site to work or to keep it working, is not used to track you anywhere else, and is not something you are asked to consent to. The Google Analytics row is the only one that depends on your answer, and it is absent entirely unless you accept.'
                : 'All of it is needed for the site to work or to keep it working, none of it is used to track you anywhere else, and there is nothing here you are asked to consent to.'}{' '}
              Clearing your browser data for this site removes the lot.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.heading}>Email we send you</h2>
            <p>
              When you sign up, you get four emails over your first fortnight: a welcome, some
              things the app does that are easy to miss, a few recipe ideas, and a note two weeks
              in asking how you are getting on. Then they stop. Everyone who signs up gets the
              same four &mdash; nothing watches what you do in the app to decide what to send you.
            </p>
            <p>
              We send these without asking first, on the basis of legitimate interests, because
              they explain a service you actively signed up for rather than advertising anything.
              They will never carry a promotion, a referral offer or anyone else&rsquo;s content
              &mdash; if that ever changed, we would have to ask your permission first, and we
              would.
            </p>
            <p>
              Every one of them has an unsubscribe link, and it works immediately. Separately, we
              may email you about things you have done &mdash; an invitation to share an account,
              for example. Those are not marketing and cannot be unsubscribed from, though there
              are very few of them.
            </p>
            <p>
              <strong>One thing worth knowing about unsubscribing.</strong>{' '}If you unsubscribe, or
              mark a message as spam, that decision is held by SendGrid, the company that sends our
              email &mdash; not by us. It is kept permanently and deliberately, so that it survives
              even if you later delete your Big Shop account and sign up again with the same
              address. It is the one piece of information about you we will not delete on request:
              deleting it would mean we could start emailing you again, which is the opposite of
              what you asked for.
            </p>
            <p>
              We do not track whether you open these emails, and we do not rewrite the links in
              them to see what you click.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.heading}>Who else processes it</h2>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Who</th>
                    <th scope="col">What for</th>
                    <th scope="col">Where</th>
                  </tr>
                </thead>
                <tbody>
                  {processors.map(p => (
                    <tr key={p.name}>
                      <th scope="row">{p.name}</th>
                      <td>{p.purpose}</td>
                      <td>{p.where}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={styles.note}>
              Your recipes and lists live in Frankfurt. The parts that run in the United States are
              the website itself, the recipe-reading and chat endpoints, and invite emails; those
              transfers rely on each provider’s standard contractual clauses.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.heading}>How long it is kept</h2>
            <p>
              Your account, recipes and lists are kept until you delete them. Error and
              performance data is not deleted on request &mdash; it expires on its own after 14
              days, and that expiry is the mechanism rather than a promise to go and find it.
              Invites disappear when accepted or rejected, and any that are never answered are
              deleted once they expire, 30 days after they were sent &mdash; so nothing is held
              indefinitely for someone who never signed up.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.heading}>Your rights, and how to use them</h2>
            <p>
              Under UK data protection law you can ask for a copy of your data, ask for it to be
              corrected, ask for it to be deleted, or object to how it is used.
            </p>
            {/* The login clause is the one sentence on this page that cannot
                be keyed to a switch the way ANALYTICS_LIVE is: whether Auth0's
                identity is really destroyed depends on AUTH0_MGMT_CLIENT_ID
                and AUTH0_MGMT_CLIENT_SECRET, which are read server-side by the
                Go API and are deliberately absent in dev, e2e and CI, where
                service.DeleteAuth0User skips instead of failing. It is
                asserted here because it was *verified against production* on
                2026-08-21 - a throwaway account deleted through /account, and
                gone from the Auth0 dashboard afterwards - not because the code
                path exists. An earlier draft made this claim while the
                credentials were unset and it was false; if they are ever
                unset again, this sentence is wrong the same day. See the board
                item this shipped from. */}
            <p>
              <strong>Deletion has a button.</strong> It is on your{' '}
              <Link href="/account">account page</Link>, and it deletes rather than deactivates:
              your login, your name and email address, your cookie choices, every invite you have
              sent or received, and &mdash; if the account is yours alone &mdash; the recipes, the
              shopping list and its history. The login record itself is removed from Auth0, so the
              account cannot be signed back into; signing up again would start a brand new, empty
              one.
            </p>
            <p>
              If we have ever emailed you, we also ask SendGrid to erase what it holds about your
              address, and SendGrid removes recipient details after 37 days in any case. The one
              thing deliberately kept is a record that you unsubscribed or reported a message as
              spam, if you ever did: deleting that would let us lawfully email you again, which
              inverts the point of asking to be forgotten.
            </p>
            <p>
              Everything else on that list is still done by hand, by email, and we would rather say
              so than imply a self-service flow that does not exist.
            </p>
            <p>
              Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and it will be actioned.
              If you are not happy with the response you can complain to the{' '}
              <a href="https://ico.org.uk/make-a-complaint/" target="_blank" rel="noreferrer">
                Information Commissioner’s Office
              </a>.
            </p>
            <p className={styles.note}>
              One honest complication, and it is worth reading before you press the button: an
              account can be shared, and recipes belong to the account rather than to you
              personally. If you are the only person on your account, deleting it takes the recipes
              and the shopping list with it. If you share it with someone else, <em>they keep the
              recipes</em> &mdash; including ones you added &mdash; and you are removed from the
              account. Either way everything about <em>you</em> goes: your login, your name, your
              email, your cookie choices and every invite in either direction. The page tells you
              which of the two will happen before you confirm.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.heading}>Changes to this page</h2>
            <p>
              If something material changes &mdash; a new company processing your data, a new
              purpose &mdash; the version at the top changes, and we will make sure you are told
              rather than leaving you to notice. Smaller corrections and clarifications are made
              quietly and do not move it, because that version is what asks everyone the cookie
              question again: re-asking for a reworded sentence is how a consent prompt becomes
              something to click past without reading. So the date at the top is the date of the
              last material change, not of the last edit.
            </p>
          </section>
        </main>

        <footer className={styles.footer}>
          <Logo className={styles.footerMark} />
          <p>Big Shop &mdash; recipes in, shopping list out.</p>
          <nav className={styles.footerLinks}>
            <Link href="/support">Support</Link>
            <button type="button" onClick={openCookieSettings}>Cookie settings</button>
          </nav>
        </footer>
      </div>
    </>
  );
}
