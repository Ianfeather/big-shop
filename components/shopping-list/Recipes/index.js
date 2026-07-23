import styles from './index.module.css';
import AddExtra from './AddExtra';
import Recipes from '@components/recipe-list';

const RecipeList = ({ recipeList, handleRecipeSelect, addExtraItem, className = '' }) => {
  return (
    <div className={className}>
      <div className={styles.module}>
        <AddExtra onAdd={addExtraItem} />
      </div>
      <div className={styles.module}>
        <Recipes selectedIds={recipeList} handleRecipeSelect={handleRecipeSelect} />
      </div>
    </div>
  )
};

export default RecipeList;
