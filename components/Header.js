import Link from 'next/link'

export default function Header() {
  return (
    <header className="header">
      <nav className="nav" role="navigation" aria-label="main navigation">
        <Link href="/">
          <a>Shopping List</a>
        </Link>
        <Link href="/recipes">
          <a>Recipes</a>
        </Link>
      </nav>
    </header>
  )
}
