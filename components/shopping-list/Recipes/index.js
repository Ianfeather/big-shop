import styles from './index.module.css';
import { useState } from 'react';
import AddExtra from './AddExtra';

const RecipeList = ({ recipes, recipeList, handleRecipeSelect, addExtraItem, clearList }) => {
  let [sidebarFilter, setSidebarFilter] = useState('');
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
        hasSelectedRecipes && (
          <div className={`${styles.recipeList} ${styles.module}`}>
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
      <div className={styles.module}>
        <AddExtra onAdd={addExtraItem} />
      </div>
      <div className={styles.module}>
        <h4 className={styles.heading}>All Recipes</h4>
        <input className={styles.input} placeholder="Search..." type="text" onChange={(e) => setSidebarFilter(e.target.value)} value={sidebarFilter} />
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

      { true && (
        <div className={styles.module}>
          <button className={styles.clearList} onClick={() => clearList()}>Clear list</button>
        </div>
      )}
    </div>
  )
};

export default RecipeList;
