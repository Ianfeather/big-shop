import { useState, useEffect } from 'react';
import { useRouter } from 'next/router'
import styles from './index.module.css';
import ListItem from '../sidebar-item';
import SidebarInput from '../sidebar-input';
import SidebarTagFilter from '../sidebar-tag-filter';
import SidebarHeading from '../sidebar-heading';
import useRecipes from '@hooks/use-recipes';
import useFetch from 'use-http'
import mocks from '../../mocks';

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === 'true';

const RecipeList = ({ handleRecipeSelect, filterFn = () => true }) => {
  const router = useRouter()
  const [recipes] = useRecipes();
  const [tags, setTags] = useState([]);
  let [sidebarFilter, setSidebarFilter] = useState('');
  let [tagsFilter, setTagsFilter] = useState('');
  const { get, response } = useFetch(process.env.NEXT_PUBLIC_API_HOST, {
    cachePolicy: 'no-cache'
  });

  useEffect(() => {
    let cancelled = false;

    async function getTags() {
      if (useMocks) {
        if (!cancelled) setTags(mocks.tags);
        return;
      }
      const _tags = await get('/tags');
      if (!cancelled && response.ok) {
        setTags(_tags);
      }
    }
    getTags();

    // React 18 Strict Mode double-invokes effects in dev (mount, cleanup,
    // mount again). Without this guard, the throwaway first call can resolve
    // after the real one and stomp good data with an aborted/empty result.
    return () => { cancelled = true };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps


  const onClick = handleRecipeSelect || function (e) {
    e.preventDefault();
    router.push(`/recipes/${e.target.id}`)
  }

  return (
    <div className={styles.panel}>
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
              .map(recipe => <ListItem {...recipe} key={recipe.id} checked={false} variant="panel" onClick={onClick}/>)
          }
        </ul>
      </div>
    </div>
  )
}

export default RecipeList;
