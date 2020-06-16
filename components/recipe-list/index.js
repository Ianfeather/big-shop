import Link from 'next/link'
import styles from './index.module.css';

export default function ({ recipes }) {
  return (
    <>
      <ul className={styles.list}>
        {
          recipes.map(({ name, id }, i) => (
            <li key={i}>
              <Link href={`/recipe/edit?id=${id}`}>
                <a>{name}</a>
              </Link>
            </li>

          ))
        }

      </ul>
      <Link href={`/recipe/new`}>
        <a className={styles.button}>Add new recipe</a>
      </Link>
    </>
  )
}
