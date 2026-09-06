import Head from 'next/head';
import Link from 'next/link';
import type { GetStaticPaths, GetStaticProps } from 'next';
import styles from './[slug].module.css';
import Logo from '@components/svg/logo';
import { useCookieSettings } from '@components/consent-banner';
import { getAllSlugs, getPost, type Post } from '../../lib/blog';
import { formatPostDate } from '../../lib/blog-format';

// One post's own page - see index.tsx for the section's framing and
// lib/blog.ts for how a markdown file under content/posts/ becomes this.
//
// Statically generated at build time (fallback: false): every slug that will
// ever exist is already on disk when `next build` runs, so there is no case
// where a request needs one rendered on demand.
//
// The HTML in the post body comes from lib/blog.ts's remark pipeline over our
// own markdown files, not from anything a visitor submits - so
// dangerouslySetInnerHTML here is rendering trusted content we wrote, the
// same reasoning pages/_document.tsx's own use of it relies on.

interface Props {
  post: Post;
}

export const getStaticPaths: GetStaticPaths = async () => {
  return {
    paths: getAllSlugs().map(slug => ({ params: { slug } })),
    fallback: false,
  };
};

export const getStaticProps: GetStaticProps<Props> = async ({ params }) => {
  const slug = params?.slug;
  if (typeof slug !== 'string') return { notFound: true };
  const post = await getPost(slug);
  return { props: { post } };
};

const SITE_URL = process.env.NEXT_PUBLIC_HOST ?? 'https://www.bigshop.life';

export default function BlogPost({ post }: Props) {
  const openCookieSettings = useCookieSettings();
  const canonical = `${SITE_URL}/about-bigshop/${post.slug}`;

  // Structured data for search engines - a BlogPosting, because that is what
  // this genuinely is. Machine-readable metadata rather than visible copy, so
  // it doesn't reintroduce the word this section is deliberately not using.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    datePublished: post.date,
    description: post.description,
    mainEntityOfPage: canonical,
    author: { '@type': 'Organization', name: 'Big Shop' },
  };

  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta charSet="utf-8" />
        <meta name="description" content={post.description} />
        <meta name="theme-color" content="#faf5ee" />
        <title>{post.title} &mdash; Big Shop</title>
        <link rel="canonical" href={canonical} />
        <meta property="og:type" content="article" />
        <meta property="og:title" content={post.title} />
        <meta property="og:description" content={post.description} />
        <meta property="og:url" content={canonical} />
        <meta name="twitter:card" content="summary" />
        <link rel="shortcut icon" crossOrigin="" href="/favicon.ico" type="image/x-icon" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </Head>

      <div className={styles.page}>
        <div className={styles.grain} aria-hidden="true" />

        <header className={styles.header}>
          <Link className={styles.brand} href="/">
            <Logo className={styles.mark} />
            <span className={styles.wordmark}>Big Shop</span>
          </Link>
          <Link href="/about-bigshop" className={styles.back}>All posts</Link>
        </header>

        <main className={styles.main}>
          <p className={styles.eyebrow}>
            <Link href="/about-bigshop" className={styles.eyebrowLink}>About Bigshop</Link>
          </p>
          <h1 className={styles.display}>{post.title}</h1>
          <time className={styles.meta} dateTime={post.date}>{formatPostDate(post.date)}</time>

          {/* Our own markdown, rendered at build time by lib/blog.ts - not user input. */}
          <article className={styles.prose} dangerouslySetInnerHTML={{ __html: post.html }} />
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
