import styles from './index.module.css';
import Tabs from '@components/layout/Tabs';
import useFetch, { CachePolicies } from 'use-http'
import { ChangeEvent, useState, useEffect, useRef } from 'react';
import Layout, { MainContent, Sidebar } from '@components/layout'
import RecipeSidebar from '@components/shopping-list/Recipes';
import ShoppingList from '@components/shopping-list/ShoppingList';
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

// The untyped get/post/patch/del below are shared across four endpoints
// (GET/POST /shopping-list, PATCH /shopping-list/buy, DELETE
// /shopping-list/clear, POST /shopping-list/extra) with different response
// shapes - same rationale as Form.tsx's shared useFetch instance.
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

  const { get, post, patch, del, response } = useFetch(process.env.NEXT_PUBLIC_API_HOST, {
    cachePolicy: CachePolicies.NO_CACHE
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

    try {
      await patch('/shopping-list/buy', { name, isBought: newList[name].isBought });
    } catch (e) {
      // todo: move the bought item back into not-bought
      console.error(e);
    }
  }

  const getListState = async (): Promise<ListState> => {
    if (useMocks) return {};

    const result: ShoppingListResult = await get('/shopping-list');
    if (cancelledRef.current) return {};
    if (response.ok && result.recipes.length) {
      setListState(result.ingredients, result.extras);
      return result;
    }
    return {};
  }

  // This will only run once on load
  async function hydrateShoppingList() {
    const { recipes = [], extras = {} } = await getListState();
    if (cancelledRef.current) return;
    setHydrateFlag(true);
    setRecipeList(recipes.reduce<Record<string, boolean>>((acc, recipe) => {
      acc[recipe] = true;
      return acc;
    }, {}));
    setExtras(extras);
  }

  async function getShoppingList() {
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
    if (!selectedRecipes.length) {
      return;
    }

    if (useMocks) {
      setListState(buildMockIngredients(selectedRecipes), extras);
      return;
    }

    const result: ShoppingListResult = await post('/shopping-list', selectedRecipes);
    if (!cancelledRef.current && response.ok) {
      setListState(result.ingredients, result.extras);
    }
  }

  async function clearList() {
    setShoppingList({});
    setExtras({});
    setRecipeList({});
    if (!useMocks) del('/shopping-list/clear');
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
      post('/shopping-list/extra', {
        name: extraItem,
        isBought: false
      });
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
