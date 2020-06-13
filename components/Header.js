import Link from 'next/link'

export default function Header({ title }) {
  return (
    <header className="header">
      <h1 className="title">{title}</h1>
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
