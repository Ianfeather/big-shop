import styles from './index.module.css';
import { useState } from 'react';
import useViewport from '../../hooks/useViewport';

const RecipeList = ({ recipes, recipeList, handleRecipeSelect }) => {
  let [sidebarFilter, setSidebarFilter] = useState('');
  const { width } = useViewport();
  const hasSelectedRecipes = Object.keys(recipeList).length > 0;

  const ListItem = ({ id, name}) => {
    let checked = recipeList[id];
    return (
      <li key={id} className={checked ? styles.checked : ''}>
        <label htmlFor={id}>
          {name}
          <input type="checkbox" id={id} className={styles.hidden} onChange={handleRecipeSelect}/>
        </label>
      </li>
    );
  };

  return (
    <div className={styles.recipeListContainer}>
      {
        width > 800 && hasSelectedRecipes && (
          <div className={styles.recipeList}>
            <h4 className={styles.heading}>Selected Recipes</h4>
            <ul>
              {
                recipes.filter(({id}) => recipeList[id])
                  .map(recipe => <ListItem {...recipe} key={recipe.id} />)
              }
            </ul>
          </div>
        )
      }
      {
        width > 800 && <h4 className={styles.heading}>All Recipes</h4>
      }
      <input className={styles.filterInput} placeholder="Search..." type="text" onChange={(e) => setSidebarFilter(e.target.value)} value={sidebarFilter} />
      <div className={styles.recipeList}>
        <ul>
          {
            recipes
              .filter(({id}) => !recipeList[id])
              .filter(({ name }) => name.toLowerCase().includes(sidebarFilter.toLowerCase()))
              .map(recipe => <ListItem {...recipe} key={recipe.id} />)
          }
        </ul>
      </div>
    </div>
  )
};

export default RecipeList;
