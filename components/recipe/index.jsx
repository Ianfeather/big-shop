import styles from './index.module.css';

const Recipe = ({ recipe }) => {

  return (
    <>
      <a href={recipe.remoteUrl}>Original recipe</a>

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
    </>
  )
}

export default Recipe;
