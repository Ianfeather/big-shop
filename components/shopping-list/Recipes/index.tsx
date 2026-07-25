import { ChangeEventHandler } from 'react';
import styles from './index.module.css';
import AddExtra from './AddExtra';
import Recipes from '@components/recipe-list';

interface RecipeListProps {
  recipeList: Record<string, boolean>;
  handleRecipeSelect: ChangeEventHandler<HTMLInputElement>;
  addExtraItem: (item: string) => void;
  className?: string;
}

const RecipeList = ({ recipeList, handleRecipeSelect, addExtraItem, className = '' }: RecipeListProps) => {
  return (
    <div className={className}>
      <div className={styles.module}>
        <AddExtra onAdd={addExtraItem} />
      </div>
      <div className={styles.module}>
        <Recipes selectedIds={recipeList} handleRecipeSelect={handleRecipeSelect} showAddButton={false} />
      </div>
    </div>
  )
};

export default RecipeList;
