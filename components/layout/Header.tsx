import Link from 'next/link'
import { useRouter } from 'next/router'
import styles from './header.module.css'
import Logo from '@components/svg/logo';
import useAuth0 from '@hooks/use-auth';
import UserMenu from '@components/user-menu';

export default function Header() {
  const router = useRouter();
  const { isAuthenticated, user } = useAuth0();

  const getClassName = (path: string) => path === router.pathname ? styles.activeLink : '';

  return (
    <header className={styles.header}>
      <Link href="/" className={styles.logo}>
        <Logo className={styles.bigShopIcon} />
        <h1 className={styles.title}>Big Shop</h1>
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
    </header>
  )
}
