import Head from 'next/head';
import Link from 'next/link';
import type { GetStaticProps } from 'next';
import styles from './index.module.css';
import Logo from '@components/svg/logo';
import { useCookieSettings } from '@components/consent-banner';
import { getAllPosts, type PostMeta } from '../../lib/blog';
import { formatPostDate } from '../../lib/blog-format';

// The listing page for /about-bigshop. Deliberately not called "Blog"
// anywhere a reader can see it - the board item this shipped from asked for
// the section to live at this path rather than under that name. The code
// below still says "blog" freely, since nothing here is user-facing.
//
// Built on the same public "Cookbook" chrome as pages/privacy.tsx and
// pages/support.tsx - paper, ink, claret headings, the grain overlay -
// rather than on components/layout, whose Header is app chrome for a
// signed-in user. A logged-out visitor is exactly who this page is for, and
// it has to be reachable *and* rendered for them - both pages/_app.tsx's
// publicRoutes and lib/analytics/page-titles.ts need an entry for this route
// (and for /about-bigshop/[slug]) or it is either unreachable logged-out or
// silently unmeasured.
//
// Posts render at build time via getStaticProps, from markdown files in
// content/posts/ - see lib/blog.ts for the pipeline. Publishing a post is
// dropping a new .md file there; nothing on this page changes.

interface Props {
  posts: PostMeta[];
}

export const getStaticProps: GetStaticProps<Props> = async () => {
  return { props: { posts: getAllPosts() } };
};

const SITE_URL = process.env.NEXT_PUBLIC_HOST ?? 'https://www.bigshop.life';

export default function AboutBigshopIndex({ posts }: Props) {
  const openCookieSettings = useCookieSettings();

  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta charSet="utf-8" />
        <meta
          name="description"
          content="Notes from the people building Big Shop: why it exists, and what's changing."
        />
        <meta name="theme-color" content="#faf5ee" />
        <title>About Bigshop &mdash; Big Shop</title>
        <link rel="canonical" href={`${SITE_URL}/about-bigshop`} />
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
          <p className={styles.eyebrow}>About Bigshop</p>
          <h1 className={styles.display}>Notes on building Big Shop.</h1>
          <p className={styles.standfirst}>
            Why it exists, what it does differently, and what changes next &mdash; written by the
            people building it, in the open.
          </p>

          <ul className={styles.postList}>
            {posts.map(post => (
              <li key={post.slug} className={styles.postCard}>
                <Link href={`/about-bigshop/${post.slug}`} className={styles.postLink}>
                  <time className={styles.postDate} dateTime={post.date}>
                    {formatPostDate(post.date)}
                  </time>
                  <h2 className={styles.postTitle}>{post.title}</h2>
                  <p className={styles.postExcerpt}>{post.description}</p>
                  <span className={styles.readMore}>Read more &rarr;</span>
                </Link>
              </li>
            ))}
          </ul>
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
}
