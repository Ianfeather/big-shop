import styles from './index.module.css';
import { useState } from 'react';

const RecipeList = ({ recipes, recipeList, handleRecipeSelect }) => {
  let [sidebarFilter, setSidebarFilter] = useState('');
  return (
    <div>
      <input className={styles.filterInput} placeholder="Filter recipes..." type="text" onChange={(e) => setSidebarFilter(e.target.value)} value={sidebarFilter} />
      <div className={styles.recipeList}>
        <ul>
          {
            recipes
              .filter(({ name }) => name.toLowerCase().includes(sidebarFilter.toLowerCase()))
              .map(({id, name}) => {
                let checked = recipeList[id];
                return (
                  <li key={id} className={checked ? styles.checked : ''}>
                    <label htmlFor={id}>
                      {name}
                      <input type="checkbox" id={id} className={styles.hidden} onChange={handleRecipeSelect}/>
                    </label>
                  </li>
                );
              })
          }
        </ul>
      </div>
    </div>
  )
};

export default RecipeList;
