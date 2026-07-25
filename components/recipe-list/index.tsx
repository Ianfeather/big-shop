import { ChangeEventHandler, useState } from 'react';
import { useRouter } from 'next/router'
import styles from './index.module.css';
import ListItem from '../sidebar-item';
import SidebarInput from '../sidebar-input';
import SidebarTagFilter from '../sidebar-tag-filter';
import SidebarHeading from '../sidebar-heading';
import Button from '@components/button';
import useRecipes from '@hooks/use-recipes';
import useTags from '@hooks/use-tags';
import icons from '@components/svg';
import type { RecipeSummary } from '../../types/models';

interface RecipeListProps {
  handleRecipeSelect?: ChangeEventHandler<HTMLInputElement>;
  filterFn?: (recipe: RecipeSummary) => boolean;
  selectedIds?: Record<string, boolean>;
  // The Shopping List's recipe picker (components/shopping-list/Recipes)
  // reuses this component for selection, not recipe management - it opts
  // out, since "Add new recipe" doesn't belong in that context.
  showAddButton?: boolean;
}

const RecipeList = ({ handleRecipeSelect, filterFn = () => true, selectedIds = {}, showAddButton = true }: RecipeListProps) => {
  const router = useRouter()
  const [recipes] = useRecipes();
  const tags = useTags();
  let [sidebarFilter, setSidebarFilter] = useState('');
  let [tagsFilter, setTagsFilter] = useState<string[]>([]);

  const onClick: ChangeEventHandler<HTMLInputElement> = handleRecipeSelect || function (e) {
    e.preventDefault();
    router.push(`/recipes/${e.target.id}`)
  }

  // Tags combine with OR: a recipe matches if it has any of the selected tags.
  function toggleTagFilter(tag: string) {
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
      // RecipeSummary.tags can be null (nullable in the OpenAPI schema, same
      // as Recipe.tags/ingredients elsewhere in this migration).
      return (recipeTags ?? []).some(tag => tagsFilter.includes(tag))
    });

  // Selected recipes float to the top of the list, so a user building a
  // shopping list can see at a glance what they've already picked.
  const orderedRecipes = [
    ...visibleRecipes.filter(({ id }) => selectedIds[id]),
    ...visibleRecipes.filter(({ id }) => !selectedIds[id])
  ];

  return (
    <div className={styles.panel}>
      { showAddButton && (
        <Button href="/recipes/new" style="primary" icon="tick" className={styles.addRecipeButton}>Add new recipe</Button>
      )}
      <div className={styles.filterRow}>
        <SidebarHeading className={styles.filterHeading}>All Recipes</SidebarHeading>
        <SidebarTagFilter onChange={toggleTagFilter} value={tagsFilter} tags={tags}/>
      </div>
      <SidebarInput icon={icons.search} placeholder="Search..." onChange={(e) => setSidebarFilter(e.target.value)} value={sidebarFilter} />
      <div className={styles.recipeList}>
        <ul>
          {
            // tags null -> undefined so ListItem's tags = [] default kicks in (JS
            // defaults only trigger on undefined, not null).
            orderedRecipes.map(recipe => <ListItem {...recipe} tags={recipe.tags ?? undefined} key={recipe.id} checked={!!selectedIds[recipe.id]} variant="panel" onClick={onClick}/>)
          }
        </ul>
      </div>
    </div>
  )
}

export default RecipeList;
