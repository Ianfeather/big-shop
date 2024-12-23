import styles from './index.module.css';

const RecipeLink = ({ link }) => {
  if (!link) return false;
  if (link.match(/^http/)) {
    return <a target="_blank" rel="noreferrer" href={link}>View original recipe</a>;
  }
  return <span>Taken from {link}</span>;
}

const Recipe = ({ recipe }) => {
  return (
    <>
      <RecipeLink link={recipe.remoteUrl} />
      <p>{recipe.notes}</p>
      <div className={styles.container}>
        {
          recipe.tags.map(tag => (
            <span key={tag} className={styles.btn}>{tag}</span>
          ))
        }
      </div>
      <div className={styles.ingredients}>
        <h3 className={styles.heading}>Ingredients</h3>
        <ul>
          {(recipe.ingredients || []).map(ingredient => (
            <li className={styles.ingredient} key={ingredient.name}>
              {ingredient.quantity} {ingredient.unit} {ingredient.name}
            </li>
          ))}
        </ul>
      </div>
      <h3>Method</h3>
      <p>{recipe.method}</p>
    </>
  )
}

export default Recipe;
