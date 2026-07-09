import styles from './index.module.css';
import AddExtra from './AddExtra';
import Recipes from '@components/recipe-list';
import ListItem from '@components/sidebar-item';
import Heading from '@components/sidebar-heading';

const RecipeList = ({ recipes, recipeList, handleRecipeSelect, addExtraItem, className = '' }) => {
  const hasSelectedRecipes = Object.keys(recipeList).length > 0;

  return (
    <div className={className}>
      {
        hasSelectedRecipes && (
          <div className={`${styles.tintedPanel} ${styles.module}`}>
            <Heading tone="tinted">Selected Recipes</Heading>
            <ul>
              {
                recipes.filter(({id}) => recipeList[id])
                  .map(recipe => <ListItem {...recipe} key={recipe.id} checked={true} variant="chip" onClick={handleRecipeSelect} />)
              }
            </ul>
          </div>
        )
      }
      <div className={styles.module}>
        <AddExtra onAdd={addExtraItem} />
      </div>
      <div className={styles.module}>
        <Recipes filterFn={({id}) => !recipeList[id]} handleRecipeSelect={handleRecipeSelect} />
      </div>
    </div>
  )
};

export default RecipeList;
