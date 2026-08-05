import Link from 'next/link'
import { useRouter } from 'next/router'
import styles from './header.module.css'
import useAuth0 from '@hooks/use-auth';
import UserMenu from '@components/user-menu';

export default function Header() {
  const router = useRouter();
  const { isAuthenticated, user } = useAuth0();

  const getClassName = (path: string) => path === router.pathname ? styles.activeLink : '';

  return (
    <header className={styles.header}>
      {/* The header's rule runs the full width of the window, but everything on
          it is capped and padded to the same box as the page content below
          (components/layout's .container) - otherwise the wordmark sits at its
          own indent and misses the page title by a few pixels at most widths. */}
      <div className={styles.inner}>
        {/* Wordmark only. The trolley mark still exists (components/svg/logo)
            and the marketing homepage still draws it large; at header size it
            was a lot of fine stroke work next to the type for no added
            recognition. */}
        <Link href="/" className={styles.logo}>
          {/* A span, not an h1: it's a link home on every page, and now that
              each page has a real <h1> in its masthead, the site name claiming
              one too gave every screen two competing top-level headings. */}
          <span className={styles.title}>Big Shop</span>
        </Link>
        {
          isAuthenticated && (
            <>
              <nav className={styles.nav} role="navigation" aria-label="main navigation">
                <Link href="/list" className={getClassName("/list")}>
                  Shopping List
                </Link>
                <Link href="/recipes" className={getClassName("/recipes")}>
                  Your Recipes
                </Link>
                <Link href="/dave" className={getClassName("/dave")}>
                  Chat with Dave
                </Link>
              </nav>
              <UserMenu user={user}/>
            </>
          )
        }
      </div>
    </header>
  )
}
