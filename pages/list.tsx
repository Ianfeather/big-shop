import styles from './list.module.css';
import Tabs from '@components/layout/Tabs';
import { useMutation } from '@tanstack/react-query';
import { ChangeEvent, useState, useEffect, useRef } from 'react';
import Layout, { MainContent, Sidebar } from '@components/layout'
import RecipeSidebar from '@components/shopping-list/Recipes';
import ShoppingList from '@components/shopping-list/ShoppingList';
import useAuth0 from '@hooks/use-auth';
import { apiGet, apiPost, apiPatch, apiDelete } from '../lib/api-client';
import type { ListIngredient } from '../types/models';


interface ShoppingListResult {
  recipes: string[];
  ingredients: Record<string, ListIngredient>;
  extras: Record<string, ListIngredient>;
}

interface ListState {
  recipes?: string[];
  ingredients?: Record<string, ListIngredient>;
  extras?: Record<string, ListIngredient>;
}

const List = () => {
  let [recipeList, setRecipeList] = useState<Record<string, boolean>>({});
  let [shoppingList, setShoppingList] = useState<Record<string, ListIngredient>>({});
  let [extras, setExtras] = useState<Record<string, ListIngredient>>({});
  let [hydrateFlag, setHydrateFlag] = useState(false);
  // React 18 Strict Mode double-invokes effects in dev (mount, cleanup, mount
  // again). Without this, the throwaway first mount's in-flight requests can
  // resolve after the real ones and stomp good state with stale/empty data.
  const cancelledRef = useRef(false);
  // getShoppingList() also fires on the very first mount (recipeList starts
  // as {}), before hydrateShoppingList's fetch has populated it from the
  // server. Without this guard that fires a regenerate call with an empty
  // recipe list and wipes out whatever was actually stored server-side.
  const hasHydratedRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => { cancelledRef.current = true; };
  }, []);

  const handleRecipeSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const newList = { ...recipeList,
      [e.target.id]: !recipeList[e.target.id]
    };
    setRecipeList(newList);
  };

  const { getAccessTokenSilently } = useAuth0();

  // Shopping List state stays in useState above rather than in a TanStack
  // Query cache, and none of the mutations below invalidate anything. That is
  // a decision, not an omission (follow-ups.md #30):
  //
  //  - Nothing outside this page reads Shopping List data, so there is no
  //    second consumer to keep in sync - which is the problem a shared cache
  //    exists to solve. The cross-page staleness that motivated #30 (['recipes'],
  //    ['units']) is real precisely because those *are* read from several places.
  //  - The regenerate call returns the recomputed list, so the page already
  //    receives authoritative server state on every change that alters it.
  //    A query alongside it would be a second copy of the same data.
  //  - Buying an item and adding an Extra Item are deliberately optimistic:
  //    the checkbox flips immediately and the request follows. Through a cache
  //    that becomes the same optimistic write via setQueryData, plus rollback
  //    plumbing, to reach the behaviour the local update already has.
  //  - The hydrate/regenerate sequencing below (hydrateFlag, hasHydratedRef) is
  //    ordering logic, not caching, and would survive the move unchanged.
  //
  // Deleting a Recipe that is on the list doesn't need invalidating here
  // either: the list is stored server-side by recipe id and re-read on mount,
  // so it corrects itself on the next visit.
  const buyMutation = useMutation({
    mutationFn: async (vars: { name: string; isBought: boolean }) => {
      const token = await getAccessTokenSilently();
      return apiPatch('/shopping-list/buy', token, vars);
    }
  });

  const regenerateMutation = useMutation({
    mutationFn: async (selectedRecipes: string[]) => {
      const token = await getAccessTokenSilently();
      return apiPost<ShoppingListResult>('/shopping-list', token, selectedRecipes);
    }
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      const token = await getAccessTokenSilently();
      return apiDelete('/shopping-list/clear', token);
    }
  });

  const addExtraMutation = useMutation({
    mutationFn: async (vars: { name: string; isBought: boolean }) => {
      const token = await getAccessTokenSilently();
      return apiPost('/shopping-list/extra', token, vars);
    }
  });

  const setListState = (ingredients: Record<string, ListIngredient>, extras: Record<string, ListIngredient>) => {
    setShoppingList(ingredients);
    setExtras(extras);
  }

  async function buyIngredient(name: string, type: 'ingredient' | 'extra') {
    const list = type === 'ingredient' ? shoppingList : extras;
    const newList = {
      ...list,
      [name]: {
        ...list[name],
        isBought: !list[name].isBought
      }
    };
    if (type === 'ingredient') {
      setShoppingList(newList);
    } else {
      setExtras(newList);
    }

    buyMutation.mutate({ name, isBought: newList[name].isBought }, {
      // todo: move the bought item back into not-bought
      onError: (e) => console.error(e)
    });
  }

  const getListState = async (): Promise<ListState> => {
    try {
      const token = await getAccessTokenSilently();
      const result = await apiGet<ShoppingListResult>('/shopping-list', token);
      if (cancelledRef.current) return {};
      if (result.recipes.length) {
        setListState(result.ingredients, result.extras);
        return result;
      }
    } catch (e) {
      console.error(e);
    }
    return {};
  }

  // This will only run once on load
  async function hydrateShoppingList() {
    const { recipes = [], extras = {} } = await getListState();
    if (cancelledRef.current) return;
    hasHydratedRef.current = true;
    setHydrateFlag(true);
    setRecipeList(recipes.reduce<Record<string, boolean>>((acc, recipe) => {
      acc[recipe] = true;
      return acc;
    }, {}));
    setExtras(extras);
  }

  async function getShoppingList() {
    if (!hasHydratedRef.current) {
      return;
    }
    // This isn't an ideal way of handling the interaction between this function and hydrateShoppingList
    // The problem is that hydrating will often lead to a change in the recipes which this fn depends on
    // However the way the shoppinglist calculation works is based on recipe id only so calling this function
    // without an actual recipe change will lead to `isBought` data being deleted.
    // Long term it would be nice to find a way to merge `isBought` data server side.
    if (hydrateFlag) {
      setHydrateFlag(false);
      return;
    }
    const selectedRecipes = Object.keys(recipeList).filter(k => !!recipeList[k]);

    try {
      const result = await regenerateMutation.mutateAsync(selectedRecipes);
      if (!cancelledRef.current) {
        setListState(result.ingredients, result.extras);
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function clearList() {
    setShoppingList({});
    setExtras({});
    setRecipeList({});
    clearMutation.mutate();
  }

  function addExtraItem(extraItem: string) {
    if (!extraItem) { return; }
    // An Extra Item is a plain checklist entry with no meaningful amount (see
    // CONTEXT.md's Shopping List Item entry), so it carries no Amounts at all;
    // department/recipe_id remain placeholders, never rendered for an extra.
    const newList = {
      ...extras,
      [extraItem]: { amounts: [], department: '', recipe_id: 0, isBought: false }
    };
    setExtras(newList);
    addExtraMutation.mutate({ name: extraItem, isBought: false });
  }

  // Both of these load data on mount / on recipe-selection change, and both
  // reach setState synchronously before their first await (getShoppingList's
  // hydrateFlag early-return in particular). Left as-is: the hydrate/regenerate
  // interaction they implement is the delicate part this file already warns
  // about above - regenerating without a real recipe change deletes isBought
  // data - and untangling it is its own piece of work, not something to do
  // while re-enabling a lint rule. (follow-ups.md #32)
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => { hydrateShoppingList() }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { getShoppingList() }, [recipeList]); // eslint-disable-line react-hooks/exhaustive-deps
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <Layout>
      <Tabs buttonsClassName={styles.tabButtons} maxWidth={800}>
        <MainContent name="Shopping List">
          <ShoppingList
            clearList={clearList}
            shoppingList={shoppingList}
            extras={extras}
            buyIngredient={buyIngredient}
            recipeCount={Object.values(recipeList).filter(Boolean).length}
          />
        </MainContent>
        <Sidebar name="Create & Edit">
          <RecipeSidebar recipeList={recipeList} addExtraItem={addExtraItem} handleRecipeSelect={handleRecipeSelect}/>
        </Sidebar>
      </Tabs>
    </Layout>
  )
}

export default List
