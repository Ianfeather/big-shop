import Link from 'next/link'
import { useState } from 'react';
import { useRouter } from 'next/router'
import styles from './index.module.css';
import ListItem from '../sidebar-item';
import SidebarInput from '../sidebar-input';
import SidebarHeading from '../sidebar-heading';
import useRecipes from '@hooks/use-recipes';

const RecipeList = ({ handleRecipeSelect, filterFn = () => true }) => {
  const router = useRouter()
  const [recipes] = useRecipes();
  let [sidebarFilter, setSidebarFilter] = useState('');

  const onClick = handleRecipeSelect || function (e) {
    e.preventDefault();
    router.push(`/recipes/${e.target.id}`);
  }

  return (
    <>
      <SidebarHeading>All Recipes</SidebarHeading>
      <SidebarInput placeholder="Search..." onChange={(e) => setSidebarFilter(e.target.value)} value={sidebarFilter} />
      <div className={styles.recipeList}>
        <ul>
          {
            recipes
              .filter(filterFn)
              .filter(({ name }) => name.toLowerCase().includes(sidebarFilter.toLowerCase()))
              .map(recipe => <ListItem {...recipe} key={recipe.id} checked={false} onClick={onClick}/>)
          }
        </ul>
      </div>
    </>
  )
}

export default RecipeList;
