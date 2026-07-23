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
import icons from '@components/svg';

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === 'true';

const RecipeList = ({ handleRecipeSelect, filterFn = () => true, selectedIds = {} }) => {
  const router = useRouter()
  const [recipes] = useRecipes();
  const [tags, setTags] = useState([]);
  let [sidebarFilter, setSidebarFilter] = useState('');
  let [tagsFilter, setTagsFilter] = useState([]);
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

  // Tags combine with OR: a recipe matches if it has any of the selected tags.
  function toggleTagFilter(tag) {
    if (tag === '') {
      setTagsFilter([]);
      return;
    }
    setTagsFilter(current => (
      current.includes(tag) ? current.filter(t => t !== tag) : [...current, tag]
    ));
  }

  const visibleRecipes = recipes
    .filter(filterFn)
    .filter(({ name }) => name.toLowerCase().includes(sidebarFilter.toLowerCase()))
    .filter(({ tags: recipeTags }) => {
      if (tagsFilter.length === 0) {
        return true;
      }
      return recipeTags.some(tag => tagsFilter.includes(tag))
    });

  // Selected recipes float to the top of the list, so a user building a
  // shopping list can see at a glance what they've already picked.
  const orderedRecipes = [
    ...visibleRecipes.filter(({ id }) => selectedIds[id]),
    ...visibleRecipes.filter(({ id }) => !selectedIds[id])
  ];

  return (
    <div className={styles.panel}>
      <div className={styles.filterRow}>
        <SidebarHeading>All Recipes</SidebarHeading>
        <SidebarTagFilter onChange={toggleTagFilter} value={tagsFilter} tags={tags}/>
      </div>
      <SidebarInput icon={icons.search} placeholder="Search..." onChange={(e) => setSidebarFilter(e.target.value)} value={sidebarFilter} />
      <div className={styles.recipeList}>
        <ul>
          {
            orderedRecipes.map(recipe => <ListItem {...recipe} key={recipe.id} checked={!!selectedIds[recipe.id]} variant="panel" onClick={onClick}/>)
          }
        </ul>
      </div>
    </div>
  )
}

export default RecipeList;
