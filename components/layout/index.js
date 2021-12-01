import Head from 'next/head'
import Header from './Header'
import styles from './index.module.css';

export default function Layout({ children, pageTitle = 'Big Shop' }) {
  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta charSet="utf-8" />
        <meta name="Description" content='Generate your own weekly shopping list'></meta>
        <meta name="mobile-web-app-capable" content="yes"/>
        <meta name="theme-color" content="#b870eb" />
        <meta name="apple-mobile-web-app-capable" content="yes"/>
        <title>{pageTitle}</title>
        <link rel="manifest" href="/manifest.json" />
        <link rel="shortcut icon" crossOrigin="" href="/favicon.ico" type="image/x-icon" />
        <link rel="apple-touch-icon" href="/static/icon512.png"/>
        <link href="/static/icon512.png" rel="apple-touch-startup-image" />
      </Head>
      <section className="layout">
        <Header />
        <div className="content">
          <section className={styles.container}>
            {children}
          </section>
        </div>
      </section>
    </>
  )
}

export const Grid = ({children, ...props}) => <div className={styles.grid} {...props}>{children}</div>
export const Sidebar = ({children, ...props}) => <div className={styles.sideBarContainer} {...props}>{children}</div>

export const MainContent = ({children, fullHeight=true, ...props}) => {
  const className = `${styles.mainContentContainer} ${fullHeight ? styles.fullHeight : ''}`;
  return <div className={className} {...props}>{children}</div>
}
