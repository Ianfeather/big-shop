import { useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import styles from './index.module.css';
import Logo from '@components/svg/logo';
import useAuth0 from '@hooks/use-auth';
import useLogin from '@hooks/use-login';
import { useCookieSettings } from '@components/consent-banner';

// The logged-out homepage: a marketing page for someone who has never heard of
// Big Shop. Editorial/print direction - warm paper, ink, one claret accent,
// brand purple as a spot colour - which the Shopping List now shares (see
// pages/styles.css's "Cookbook" tokens and components/layout/header.module.css).
//
// A logged-in user sees all of it too. This page used to redirect them to
// /list, which is what made it flash the pitch at its own customers on the way
// past - marketing page, then blank, then /list, three states where there
// should be one (follow-ups.md #58). The redirect is gone; `/` now does one
// job, and the header is what tells a logged-in visitor where their list is.
//
// It now redirects nobody at all. Coming back from Auth0 used to land here and
// be forwarded on; that callback goes straight to /list (lib/app-origin.ts), so
// this page has one job and no navigation of its own. What is left is the
// `data-auth` stamp, which only decides which CTAs a logged-in visitor sees.

// The two human needs underneath the mechanics: the deciding, and the buying
// twice. Both are written as a concession followed by the real claim - saying
// what it can't do first is what makes the second half believable, and it keeps
// us off the two claims we can't back. We have no price data and no receipts,
// so nothing here says "save money"; the money point is waste avoided, which is
// mechanically true of combining, rather than savings earned, which isn't ours
// to claim. Same for time: no minutes, because the time it gives back is spent
// deciding, not chopping.
const why = [
  {
    concession: 'It won’t do the cooking.',
    claim: 'It’ll stop the deciding.',
    body: 'Deciding is the part that actually takes the time. Everything you’ve liked before is in one place, tagged and searchable, so choosing five meals for the week is five ticks — not half an hour of “I don’t mind, what do you fancy?” on a Sunday night.',
  },
  {
    concession: 'It doesn’t make food cheaper.',
    claim: 'It stops you buying it twice.',
    body: 'Three jars of cumin. A second bag of rice. The mid-week top-up trip that somehow costs forty quid. Buying for the whole week in one go, off a list that has already added everything up, is the cheap way to shop — this is the thing that makes actually doing it possible.',
  },
];

const method = [
  {
    n: '01',
    title: 'Put a recipe in',
    body: 'Paste a link from any recipe site, photograph a page of a cookbook, or type it out. It’s read for you and comes back as ingredients, method and tags — ready to cook from, and ready to shop from.',
  },
  {
    n: '02',
    title: 'Say what you’re cooking',
    body: 'Tick the meals you want this week. Filter by Vegetarian or Batch Cook when nothing comes to mind, or ask Dave to suggest from what you already own.',
  },
  {
    n: '03',
    title: 'Take the list to the shop',
    body: 'Every ingredient across every chosen recipe, added up into one line each and sorted into the order you walk the aisles. Tick things off as they go in the trolley — and whoever else is shopping sees them go.',
  },
];

// The two that actually make someone switch get the large treatment; the rest
// are reassurance and sit in a smaller grid underneath.
const leadNotes = [
  {
    title: 'Nobody comes home with a second bag of rice',
    body: 'Invite whoever you shop with by email. Same recipes, same list, same ticked boxes — updating in both your pockets while you’re stood in different aisles.',
  },
  {
    title: 'It does the adding up',
    body: 'Three recipes wanting onions is one line saying how many onions. Where two amounts genuinely can’t be added — 50 g and 2 tbsp of flour — you get one line carrying both, not two lines to hunt for.',
  },
];

const notes = [
  {
    title: 'It knows what a tin is',
    body: 'A tin of chopped tomatoes is 400 g, a clove is 5 g, a potato is about 180 g. So the list says “2 tins”, which is a thing you can pick up, with the raw total kept alongside.',
  },
  {
    title: 'Bin bags too',
    body: 'Bin bags, milk, the birthday card. Add extras straight to the list and they sit alongside everything the recipes asked for.',
  },
  {
    title: '“That lentil thing we had in March”',
    body: 'Everything you’ve saved in one place, searchable by name and filterable by tag — so the one you can only half remember is still findable.',
  },
  {
    title: 'Ask what’s for dinner',
    body: 'Dave only knows your kitchen — your recipes, what you cooked recently, what you keep going back to. Ask what to cook this week and it’ll build the list for you.',
  },
];

// Objections in the order they actually occur to someone reading this page,
// answered immediately before the last ask. Nothing here promises anything the
// app doesn't already do - notably there is no export yet, so nothing claims one.
const questions = [
  {
    q: 'Do I have to type all my recipes in?',
    a: 'No. Paste a link and the page is read for you; photograph a cookbook and so is that. Typing is the fallback rather than the default — and even then you can paste the whole ingredient list in one lump instead of a row at a time.',
  },
  {
    q: 'Will it work with the sites I use?',
    a: 'It reads the page itself rather than following rules written for a handful of named sites, so it isn’t limited to a supported list. When a page does defeat it, what it did get still opens in the form and you fill in the rest.',
  },
  {
    q: 'Can I share it with the person I shop with?',
    a: 'Yes — invite them by email and you have one collection and one list between you, ticked boxes and all. That’s the whole point of it, not an extra.',
  },
  {
    q: 'What does it cost?',
    a: 'Nothing. There’s no card to enter, no trial counting down, and no plan to be upgraded to.',
  },
];

// The real output of putting the two starter recipes on the list: same items,
// same amounts, same order (department order, bought items moved down) and the
// same markup as components/shopping-list/ShoppingList - so what's advertised
// here is what /list actually renders.
const listPreview = [
  { name: 'Beef Mince', amount: '500 gram' },
  { name: 'Olive Oil', amount: '2 tablespoon' },
  { name: 'Spaghetti', amount: '400 gram' },
  { name: 'Celery', amount: '2 whole' },
  { name: 'Garlic Clove', amount: '4 clove' },
  { name: 'Onion', amount: '2 whole' },
  { name: 'Bin bags', amount: '' },
];

const boughtPreview = [{ name: 'Chopped Tomatoes', amount: '3 tin (1.2 kilogram)' }];

interface PreviewItemProps {
  name: string;
  amount: string;
  bought?: boolean;
}

const PreviewItem = ({ name, amount, bought = false }: PreviewItemProps) => (
  <li className={`${styles.item} ${bought ? styles.bought : ''}`}>
    <span className={styles.check} aria-hidden="true">
      <span className={styles.checkMark} />
    </span>
    <span className={styles.itemName}>{name}</span>
    {amount && <span className={styles.amount}>{amount}</span>}
  </li>
);

const Index = () => {
  const { isAuthenticated, isLoading } = useAuth0();
  const { logIn, signUp } = useLogin();
  const openCookieSettings = useCookieSettings();


  // Both CTAs come in two versions - "sign up" and "go to your list" - and,
  // like the header, which one shows is decided in CSS from the `data-auth`
  // stamp rather than here. Anyone logged in gets the second: they do not need
  // selling to, and telling an existing customer to "Add your first recipe"
  // under the word "Free" is nonsense the moment this page stops redirecting
  // them away.
  //
  // This used to be keyed off `status === 'onboarding'`, which reached the same
  // two variants by a narrower route - a first-time user, once, immediately
  // after signing up. Every logged-in visitor is now that audience, so the
  // stamp subsumes it and the flag is gone. `status` still exists; it decides
  // the redirect and nothing about what is rendered.

  // The authoritative half of the `data-auth` stamp that pages/_document.tsx
  // guesses at before first paint. Everything the stamp drives is in
  // index.module.css; React sets the attribute and does not branch on it, so
  // the markup is identical on the server and the client and there is no
  // hydration mismatch to reconcile.
  //
  // Writing it from an effect rather than during render is the point: this
  // runs after the guess has already done its job, and its only purpose is to
  // correct the guess once Auth0 has actually answered.
  useEffect(() => {
    const el = document.documentElement;
    // While the SDK is still checking, leave the pre-paint guess exactly where
    // it is. It is the best answer available, and replacing it with 'out' here
    // would produce the "Log in" button flickering into "Your shopping list"
    // that this whole mechanism exists to remove.
    if (isLoading) return;

    // Two answers now, not three. There used to be a 'returning' state that
    // veiled the page while an authenticated arrival was on its way to /list -
    // necessary when Auth0's callback landed here and this page had to forward
    // it on. The callback goes straight to /list now (lib/app-origin.ts), so
    // nobody passes through mid-login and there is nothing to veil: everyone
    // who reaches `/` meant to.
    el.dataset.auth = isAuthenticated ? 'in' : 'out';

    // <html> outlives this page, so clear the stamp on the way out rather than
    // letting a client-side navigation carry it to a page that never set it.
    return () => { delete el.dataset.auth; };
  }, [isLoading, isAuthenticated]);

  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta charSet="utf-8" />
        <meta
          name="description"
          content="Big Shop keeps your recipes in one place and turns the ones you're cooking this week into a single shopping list - ingredients added up across every dish and sorted by aisle. Free, and shared with whoever you shop with."
        />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="theme-color" content="#faf5ee" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <title>Big Shop &mdash; recipes in, shopping list out</title>
        <link rel="manifest" href="/manifest.json" />
        <link rel="shortcut icon" crossOrigin="" href="/favicon.ico" type="image/x-icon" />
        <link rel="apple-touch-icon" href="/static/icon512.png" />
        <link href="/static/icon512.png" rel="apple-touch-startup-image" />
      </Head>

      <div className={styles.page}>
        <div className={styles.grain} aria-hidden="true" />

        <header className={styles.header}>
          <a className={styles.brand} href="#top">
            <Logo className={styles.mark} />
            <span className={styles.wordmark}>Big Shop</span>
          </a>
          {/* Both affordances are always in the markup, and CSS decides which
              one is shown from the `data-auth` stamp on <html>. That is what
              lets the right one be painted before React has run at all - a
              ternary here could only ever swap it after hydration, which is
              the seam follow-ups.md #58 describes as changing under the
              cursor. The hidden one is `display: none`, so it is out of the
              accessibility tree too rather than announced twice. */}
          <Link href="/list" className={`${styles.logIn} ${styles.whenLoggedIn}`}>
            Your shopping list
          </Link>
          <button
            type="button"
            className={`${styles.logIn} ${styles.whenLoggedOut}`}
            onClick={logIn}
            disabled={isLoading}
          >
            Log in
          </button>
        </header>

        <main id="top">
          <section className={styles.hero}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>The shop you do every week</p>
              <h1 className={styles.display}>
                Start with one recipe.
                <br />
                <em>The list builds itself.</em>
              </h1>
              <p className={styles.standfirst}>
                Big Shop keeps your recipes together, and turns the ones you’ve chosen this week into a
                single shopping list &mdash; ingredients added up across every dish and sorted by aisle.
                One decision on Sunday, one trip, nothing bought twice.
              </p>
              <div className={`${styles.actions} ${styles.whenLoggedIn}`}>
                <Link href="/list" className={styles.primary}>Start building your shopping list</Link>
              </div>
              {/* One action only. Anyone who already has an account has the
                  Log in button in the header, three inches up. */}
              <div className={`${styles.actions} ${styles.whenLoggedOut}`}>
                <button type="button" className={styles.primary} onClick={signUp}>Add your first recipe</button>
              </div>
              <p className={`${styles.footnote} ${styles.whenLoggedOut}`}>
                <strong className={styles.free}>Free.</strong>{' '}
                No card, no app to install &mdash; it works on the phone that’s already in your
                hand at the shop.
              </p>
            </div>

            <div className={styles.heroCard}>
              <div className={styles.card} role="img" aria-label="Example shopping list: beef mince, olive oil, spaghetti, celery, garlic cloves, onions and bin bags still to buy, with three tins of chopped tomatoes already ticked off.">
                <p className={styles.cardTitle}>Your shopping list</p>
                <ul className={styles.items}>
                  {listPreview.map((item) => (
                    <PreviewItem key={item.name} name={item.name} amount={item.amount} />
                  ))}
                </ul>
                <p className={styles.boughtHeading}>Already bought</p>
                <ul className={styles.items}>
                  {boughtPreview.map((item) => (
                    <PreviewItem key={item.name} name={item.name} amount={item.amount} bought />
                  ))}
                </ul>
              </div>
              <p className={styles.caption}>
                Two recipes, one list. The tins of tomatoes both of them wanted have already been added
                together &mdash; and ticked off in the trolley.
              </p>
            </div>
          </section>

          <section className={styles.whySection}>
            <h2 className={styles.sectionHeading}>What it’s actually for</h2>
            <div className={styles.why}>
              {why.map((item) => (
                <article key={item.claim} className={styles.reason}>
                  <h3 className={styles.reasonTitle}>
                    <span className={styles.concession}>{item.concession}</span> {item.claim}
                  </h3>
                  <p className={styles.reasonBody}>{item.body}</p>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.methodSection}>
            <h2 className={styles.sectionHeading}>Method</h2>
            <ol className={styles.method}>
              {method.map((step) => (
                <li key={step.n} className={styles.step}>
                  <span className={styles.stepNumber}>{step.n}</span>
                  <div>
                    <h3 className={styles.stepTitle}>{step.title}</h3>
                    <p className={styles.stepBody}>{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className={styles.sourcesSection}>
            <p className={styles.eyebrow}>Three ways in</p>
            <div className={styles.sources}>
              <article className={styles.source}>
                <h3>A link</h3>
                <p>Any recipe site. The page is read for you and comes back as name, ingredients, method and tags &mdash; with American cups and ounces turned into grams on the way in.</p>
              </article>
              <article className={styles.source}>
                <h3>A photograph</h3>
                <p>Point your phone at a cookbook or a handwritten card. Handled in the background while you carry on.</p>
              </article>
              <article className={styles.source}>
                <h3>Your own words</h3>
                <p>Type it, or paste the ingredient list in one lump and let it be split into proper rows.</p>
              </article>
            </div>
          </section>

          <section className={styles.notesSection}>
            <h2 className={styles.sectionHeading}>The fiddly bits</h2>
            <div className={styles.leadNotes}>
              {leadNotes.map((note) => (
                <article key={note.title} className={styles.leadNote}>
                  <h3 className={styles.leadNoteTitle}>{note.title}</h3>
                  <p className={styles.leadNoteBody}>{note.body}</p>
                </article>
              ))}
            </div>
            <div className={styles.notes}>
              {notes.map((note) => (
                <article key={note.title} className={styles.note}>
                  <h3 className={styles.noteTitle}>{note.title}</h3>
                  <p className={styles.noteBody}>{note.body}</p>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.colophonSection}>
            <div className={styles.colophon}>
              <article>
                <h2 className={styles.colophonTitle}>Built for one household’s weekly shop</h2>
                {/* Deliberately no longer lists the pains - the "What it's
                    actually for" band does that far better, and repeating them
                    here made this read as a weaker second attempt. What's left
                    is the thing that band can't say: who built it, and what it
                    refuses to become. */}
                <p className={styles.colophonBody}>
                  There’s no growth team here, and no roadmap of things nobody asked for. It does
                  recipes, and the list that falls out of them, and it does those properly. It isn’t
                  going to become your calendar, your macros tracker or your fridge.
                </p>
              </article>
              <article>
                <h2 className={styles.colophonTitle}>It gets better as more people cook</h2>
                <p className={styles.colophonBody}>
                  How much a tin holds, what a potato weighs, which aisle a thing lives in &mdash;
                  that’s one shared reference rather than something every kitchen re-enters. Worked
                  out once, and every list after it is that bit more accurate.
                </p>
              </article>
            </div>
          </section>

          <section className={styles.questionsSection}>
            <h2 className={styles.sectionHeading}>Questions</h2>
            <dl className={styles.questions}>
              {questions.map((item) => (
                <div key={item.q} className={styles.question}>
                  <dt className={styles.questionTitle}>{item.q}</dt>
                  <dd className={styles.questionBody}>{item.a}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className={styles.closer}>
            <h2 className={styles.closerHeading}>
              Everything you cook,
              <br />
              <em>one list</em> to buy it.
            </h2>
            <Link href="/list" className={`${styles.primary} ${styles.whenLoggedIn}`}>
              Start building your shopping list
            </Link>
            <button type="button" className={`${styles.primary} ${styles.whenLoggedOut}`} onClick={signUp}>
              Start with one recipe
            </button>
            <p className={`${styles.closerFootnote} ${styles.whenLoggedOut}`}>
              <strong className={styles.free}>Free.</strong> One recipe is enough to make a list.
            </p>
          </section>
        </main>

        <footer className={styles.footer}>
          <Logo className={styles.footerMark} />
          <p>Big Shop &mdash; recipes in, shopping list out.</p>
          <nav className={styles.footerLinks}>
            <Link href="/privacy">Privacy</Link>
            <Link href="/support">Support</Link>
            <button type="button" onClick={openCookieSettings}>Cookie settings</button>
          </nav>
        </footer>
      </div>
    </>
  );
};

export default Index;
