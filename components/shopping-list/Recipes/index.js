import styles from './index.module.css';
import AddExtra from './AddExtra';
import Recipes from '@components/recipe-list';
import ListItem from '@components/sidebar-item';
import Heading from '@components/sidebar-heading';
import Button from '@components/button';

const RecipeList = ({ recipes, recipeList, handleRecipeSelect, addExtraItem, clearList, className = '' }) => {
  const hasSelectedRecipes = Object.keys(recipeList).length > 0;

  return (
    <div className={className}>
      {
        hasSelectedRecipes && (
          <div className={`${styles.recipeList} ${styles.module}`}>
            <Heading>Selected Recipes</Heading>
            <ul>
              {
                recipes.filter(({id}) => recipeList[id])
                  .map(recipe => <ListItem {...recipe} key={recipe.id} checked={true} onClick={handleRecipeSelect} />)
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

      { true && (
        <div className={styles.module}>
          <Button style="red" icon="cross" onClick={() => clearList()}>Clear list</Button>
        </div>
      )}
    </div>
  )
};

export default RecipeList;
