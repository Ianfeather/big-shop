import styles from './index.module.css';
import Tabs from '@components/layout/Tabs';
import { useMutation } from '@tanstack/react-query';
import { ChangeEvent, useState, useEffect, useRef } from 'react';
import Layout, { MainContent, Sidebar } from '@components/layout'
import RecipeSidebar from '@components/shopping-list/Recipes';
import ShoppingList from '@components/shopping-list/ShoppingList';
import useAuth0 from '@hooks/use-auth';
import { apiGet, apiPost, apiPatch, apiDelete } from '../lib/api-client';
import mocks from '../mocks';
import type { ListIngredient } from '../types/models';

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === 'true';

function buildMockIngredients(selectedRecipeIds: string[]): Record<string, ListIngredient> {
  const ingredients: Record<string, ListIngredient> = {};
  selectedRecipeIds.forEach(id => {
    const recipe = mocks.recipes.find(r => String(r.id) === String(id));
    if (!recipe) return;
    recipe.ingredients.forEach(ingredient => {
      ingredients[ingredient.name] = {
        unit: ingredient.unit,
        quantity: Number(ingredient.quantity),
        isBought: false,
        recipe_id: recipe.id,
        department: ingredient.department,
      };
    });
  });
  return ingredients;
}

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

    if (useMocks) return;

    buyMutation.mutate({ name, isBought: newList[name].isBought }, {
      // todo: move the bought item back into not-bought
      onError: (e) => console.error(e)
    });
  }

  const getListState = async (): Promise<ListState> => {
    if (useMocks) return {};

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

    if (useMocks) {
      setListState(buildMockIngredients(selectedRecipes), extras);
      return;
    }

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
    if (!useMocks) clearMutation.mutate();
  }

  function addExtraItem(extraItem: string) {
    if (!extraItem) { return; }
    // Extra Items carry placeholder quantity/unit/department/recipe_id
    // values (see CONTEXT.md's Shopping List Item entry) - never rendered
    // for an extra (ShoppingList/Item.tsx only reads them for 'ingredient').
    const newList = {
      ...extras,
      [extraItem]: { quantity: 0, unit: '', department: '', recipe_id: 0, isBought: false }
    };
    setExtras(newList);
    if (!useMocks) {
      addExtraMutation.mutate({ name: extraItem, isBought: false });
    }
  }

  useEffect(() => { hydrateShoppingList() }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { getShoppingList() }, [recipeList]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Layout>
      <Tabs buttonsClassName={styles.tabButtons} maxWidth={800}>
        <MainContent name="Shopping List">
          <ShoppingList clearList={clearList} shoppingList={shoppingList} extras={extras} buyIngredient={buyIngredient} />
        </MainContent>
        <Sidebar name="Create & Edit">
          <RecipeSidebar recipeList={recipeList} addExtraItem={addExtraItem} handleRecipeSelect={handleRecipeSelect}/>
        </Sidebar>
      </Tabs>
    </Layout>
  )
}

export default List
