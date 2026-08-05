import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useMutation } from '@tanstack/react-query';
import styles from './index.module.css';
import Logo from '@components/svg/logo';
import useAuth0 from '@hooks/use-auth';
import useLogin from '@hooks/use-login';
import { apiPost, apiPatch } from '../lib/api-client';
import type { User } from '../types/models';

// The logged-out homepage: a marketing page for someone who has never heard of
// Big Shop. Editorial/print direction - warm paper, ink, one claret accent,
// brand purple as a spot colour - which the Shopping List now shares (see
// pages/styles.css's "Cookbook" tokens and components/layout/header.module.css).
//
// An already-onboarded user never sees any of it: the effect below redirects
// them to /list, exactly as this page did before it was rewritten.

const method = [
  {
    n: '01',
    title: 'Put a recipe in',
    body: 'Paste a link from any recipe site, photograph a page of a cookbook, or type it out. It gets read, pulled apart into ingredients and method, and filed.',
  },
  {
    n: '02',
    title: 'Say what you’re cooking',
    body: 'Tick the meals you want this week. Filter by Vegetarian or Batch Cook when nothing comes to mind, or ask Dave to suggest from what you already own.',
  },
  {
    n: '03',
    title: 'Take the list to the shop',
    body: 'Every ingredient across every chosen recipe, added up into one line each and sorted into the order you walk the aisles. Tick things off as they go in the trolley.',
  },
];

const notes = [
  {
    title: 'It does the adding up',
    body: 'Three recipes wanting onions is one line saying how many onions. Where two amounts genuinely can’t be added — 50 g and 2 tbsp of flour — you get one line carrying both, not two lines to hunt for.',
  },
  {
    title: 'It knows what a tin is',
    body: 'A tin of chopped tomatoes is 400 g, a clove is 5 g, a potato is about 180 g. So the list says “2 tins”, which is a thing you can pick up, with the raw total kept alongside.',
  },
  {
    title: 'One list per household',
    body: 'Invite whoever you shop with by email. Same recipes, same list, same ticked boxes — so nobody comes home with a second bag of rice.',
  },
  {
    title: 'Room for the non-recipe things',
    body: 'Bin bags, milk, the birthday card. Add extras straight to the list and they sit alongside everything the recipes asked for.',
  },
  {
    title: 'Your own collection, searchable',
    body: 'Everything you’ve saved in one place, searchable by name and filterable by tag — so “that lentil thing we had in March” is findable.',
  },
  {
    title: 'And Dave, if you’re stuck',
    body: 'A chat that can only see your recipes. It remembers what you cooked recently and what you keep going back to, and will build the list for you.',
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
  const { isAuthenticated, isLoading, user, getAccessTokenSilently } = useAuth0();
  const { logIn, signUp } = useLogin();
  const router = useRouter();
  // null while we're still checking onboarded status - kept blank rather than
  // flashing the marketing copy at an already-onboarded user who's about to be
  // redirected to /list.
  const [status, setStatus] = useState<'onboarding' | 'redirecting' | null>(null);

  // Neither mutation invalidates: no cached query reads User state, and on
  // first login there is nothing in the cache yet to be stale.
  const saveUserMutation = useMutation({
    mutationFn: async (payload: { name?: string; email?: string }) => {
      const token = await getAccessTokenSilently();
      return apiPost<User>('/user', token, payload);
    }
  });

  const completeOnboardingMutation = useMutation({
    mutationFn: async () => {
      const token = await getAccessTokenSilently();
      return apiPatch('/user/onboarding', token);
    }
  });

  useEffect(() => {
    if (isLoading || !isAuthenticated) return;

    async function resolveOnboarding() {
      if (!user) return;
      const { name, email } = user;
      const saved = await saveUserMutation.mutateAsync({ name, email }).catch(() => undefined);
      if (saved?.onboarded) {
        setStatus('redirecting');
        router.replace('/list');
        return;
      }
      // First-time user: show the onboarding screen once, and mark them
      // onboarded in the background so their next login skips straight to /list.
      setStatus('onboarding');
      completeOnboardingMutation.mutate();
    }
    resolveOnboarding();
  }, [isLoading, isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  // A first-time user who has just signed up lands here once. They don't need
  // selling to any more, so both CTAs become the one link into the product.
  const onboarding = status === 'onboarding';

  // Blank rather than the marketing copy for anyone already logged in whose
  // onboarding state is still being resolved: they're about to be sent to
  // /list, and a flash of the pitch on the way there reads as a bug.
  const resolvingLoggedInUser = isAuthenticated && status !== 'onboarding';

  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta charSet="utf-8" />
        <meta
          name="description"
          content="Big Shop keeps your recipes in one place and turns the ones you're cooking this week into a single shopping list - ingredients added up across every dish and sorted by aisle."
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

      {resolvingLoggedInUser ? <div className={styles.page} /> : (
      <div className={styles.page}>
        <div className={styles.grain} aria-hidden="true" />

        <header className={styles.header}>
          <a className={styles.brand} href="#top">
            <Logo className={styles.mark} />
            <span className={styles.wordmark}>Big Shop</span>
          </a>
          {isAuthenticated ? (
            <Link href="/list" className={styles.logIn}>Your shopping list</Link>
          ) : (
            <button type="button" className={styles.logIn} onClick={logIn} disabled={isLoading}>
              Log in
            </button>
          )}
        </header>

        <main id="top">
          <section className={styles.hero}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>Recipes &amp; the weekly shop</p>
              <h1 className={styles.display}>
                Start with one recipe.
                <br />
                <em>The list builds itself.</em>
              </h1>
              <p className={styles.standfirst}>
                Big Shop keeps your recipes together, and turns the ones you’ve chosen this week into a
                single shopping list &mdash; ingredients added up across every dish and sorted by aisle.
              </p>
              {onboarding ? (
                <div className={styles.actions}>
                  <Link href="/list" className={styles.primary}>Start building your shopping list</Link>
                </div>
              ) : (
                <>
                  <div className={styles.actions}>
                    <button type="button" className={styles.primary} onClick={signUp}>Get started</button>
                    <button type="button" className={styles.secondary} onClick={logIn}>I already have an account</button>
                  </div>
                  <p className={styles.footnote}>Free. No app to install. Works on the phone in your hand at the shop.</p>
                </>
              )}
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
                <p>Any recipe site. The page is read for you and comes back as name, ingredients, method and tags.</p>
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
            <h2 className={styles.sectionHeading}>Notes</h2>
            <div className={styles.notes}>
              {notes.map((note) => (
                <article key={note.title} className={styles.note}>
                  <h3 className={styles.noteTitle}>{note.title}</h3>
                  <p className={styles.noteBody}>{note.body}</p>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.closer}>
            <h2 className={styles.closerHeading}>
              Everything you cook,
              <br />
              <em>one list</em> to buy it.
            </h2>
            {onboarding ? (
              <Link href="/list" className={styles.primary}>Start building your shopping list</Link>
            ) : (
              <button type="button" className={styles.primary} onClick={signUp}>Get started</button>
            )}
          </section>
        </main>

        <footer className={styles.footer}>
          <Logo className={styles.footerMark} />
          <p>Big Shop &mdash; recipes in, shopping list out.</p>
        </footer>
      </div>
      )}
    </>
  );
};

export default Index;
