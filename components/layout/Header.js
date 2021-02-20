import Link from 'next/link'
import { useRouter } from 'next/router'
import styles from './header.module.css'

export default function Header() {
  const router = useRouter();

  const getClassName = (path) => path === router.pathname ? styles.activeLink : '';

  return (
    <header className={styles.header}>
      <Link href="/">
        <a className={styles.logo}>
          <svg className={styles.bigShopIcon} xmlns="http://www.w3.org/2000/svg" viewBox="80 60 180 178"><defs></defs><title>i-3</title><polyline points="160.35 122.81 163.72 105.96 183.31 109.88 200.21 113.26 198.3 122.81"/><polyline points="133.42 122.81 133.42 94.32 183.31 94.32 183.31 109.88"/><path d="M131.67,170.62h64.17a7.31,7.31,0,0,0,7.09-6.24l1.8-10.63,2.57-15.13,2.57-15.18a.52.52,0,0,0-.5-.63h-90.5"/><polyline points="141.12 124.29 144.77 138.62 148.62 153.75 152.91 170.62"/><polyline points="162.28 123.86 165.81 138.62 169.42 153.75 173.45 170.62"/><polyline points="184.05 124.37 187.13 138.62 190.4 153.75 194.05 170.62"/><polyline points="123.14 138.62 144.77 138.62 165.81 138.62 187.13 138.62 207.3 138.62"/><polyline points="127.17 153.75 148.62 153.75 169.42 153.75 190.4 153.75 204.73 153.75"/><path d="M99.2,110.83h13.45a4,4,0,0,1,3.86,3l2.41,9,4.21,15.81h0l4,15.13,4.5,16.87L125.61,179c-1.93,3.64.57,8.13,4.55,8.13H204"/><circle cx="147.11" cy="197.05" r="6.74"/><circle cx="185.13" cy="197.05" r="6.74"/><line x1="215.42" y1="112.26" x2="225.58" y2="104.84"/><line x1="205.58" y1="105.96" x2="208.51" y2="93.73"/><line x1="218.9" y1="124.2" x2="231.44" y2="125.14"/></svg>
          <h1 className={styles.title}>Big Shop</h1>
        </a>
      </Link>
      <nav className={styles.nav} role="navigation" aria-label="main navigation">
        <Link href="/">
          <a className={getClassName("/")}>Shopping List</a>
        </Link>
        <Link href="/recipes">
          <a className={getClassName("/recipes")}>Your Recipes</a>
        </Link>
      </nav>
    </header>
  )
}
