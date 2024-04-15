import { useState, useEffect } from 'react';
import { useRouter } from 'next/router'
import styles from './index.module.css';
import ListItem from '../sidebar-item';
import SidebarInput from '../sidebar-input';
import SidebarTagFilter from '../sidebar-tag-filter';
import SidebarHeading from '../sidebar-heading';
import useRecipes from '@hooks/use-recipes';
import useFetch from 'use-http'

const RecipeList = ({ handleRecipeSelect, filterFn = () => true }) => {
  const router = useRouter()
  const [recipes] = useRecipes();
  const [tags, setTags] = useState([]);
  let [sidebarFilter, setSidebarFilter] = useState('');
  let [tagsFilter, setTagsFilter] = useState('');
  const { get, response } = useFetch(process.env.NEXT_PUBLIC_API_HOST, {
    cachePolicy: 'no-cache'
  });

  async function getTags() {
    const _tags = await get('/tags');
    if (response.ok) {
      setTags(_tags);
    }
  }
  useEffect(() => { getTags() }, []); // eslint-disable-line react-hooks/exhaustive-deps


  const onClick = handleRecipeSelect || function (e) {
    e.preventDefault();
    router.push(`/recipes/${e.target.id}`)
  }

  return (
    <>
      <SidebarHeading>All Recipes</SidebarHeading>
      <SidebarInput placeholder="Search..." onChange={(e) => setSidebarFilter(e.target.value)} value={sidebarFilter} />
      <SidebarTagFilter onChange={(value) => setTagsFilter(value)} value={tagsFilter} tags={tags}/>
      <div className={styles.recipeList}>
        <ul>
          {
            recipes
              .filter(filterFn)
              .filter(({ name }) => name.toLowerCase().includes(sidebarFilter.toLowerCase()))
              .filter(({ tags: recipeTags }) => {
                if (tagsFilter === '') {
                  return true;
                }
                return recipeTags.some(tag => tag === tagsFilter)
              })
              .map(recipe => <ListItem {...recipe} key={recipe.id} checked={false} onClick={onClick}/>)
          }
        </ul>
      </div>
    </>
  )
}

export default RecipeList;
