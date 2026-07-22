import styles from './index.module.css';
import Tabs from '@components/layout/Tabs';
import useFetch from 'use-http'
import { useState, useEffect, useRef } from 'react';
import Layout, { MainContent, Sidebar } from '@components/layout'
import RecipeSidebar from '@components/shopping-list/Recipes';
import ShoppingList from '@components/shopping-list/ShoppingList';
import useRecipes from '@hooks/use-recipes';
import mocks from '../mocks';

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === 'true';

function buildMockIngredients(selectedRecipeIds) {
  const ingredients = {};
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

const List = () => {
  const [recipes] = useRecipes();
  let [recipeList, setRecipeList] = useState({});
  let [shoppingList, setShoppingList] = useState({});
  let [extras, setExtras] = useState({});
  let [hydrateFlag, setHydrateFlag] = useState(false);
  // React 18 Strict Mode double-invokes effects in dev (mount, cleanup, mount
  // again). Without this, the throwaway first mount's in-flight requests can
  // resolve after the real ones and stomp good state with stale/empty data.
  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => { cancelledRef.current = true; };
  }, []);

  const handleRecipeSelect = (e) => {
    const newList = { ...recipeList,
      [e.target.id]: !recipeList[e.target.id]
    };
    setRecipeList(newList);
  };

  const { get, post, patch, del, response } = useFetch(process.env.NEXT_PUBLIC_API_HOST, {
    cachePolicy: 'no-cache'
  });

  const setListState = (ingredients, extras) => {
    setShoppingList(ingredients);
    setExtras(extras);
  }

  async function buyIngredient(name, type) {
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

  const getListState = async () => {
    if (useMocks) return {};

    const result = await get('/shopping-list');
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
    setRecipeList(recipes.reduce((acc, recipe) => {
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

    const result = await post('/shopping-list', selectedRecipes);
    if (!cancelledRef.current && response.ok) {
      setListState(result.ingredients, result.extras);
    }
  }

  async function clearList() {
    setShoppingList({});
    setExtras({});
    setRecipeList([]);
    if (!useMocks) del('/shopping-list/clear');
  }

  function addExtraItem(extraItem) {
    if (!extraItem) { return; }
    const newList = {
      ...extras,
      [extraItem]: { quantity: '', unit: '' }
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
          <RecipeSidebar recipeList={recipeList} addExtraItem={addExtraItem} recipes={recipes} handleRecipeSelect={handleRecipeSelect}/>
        </Sidebar>
      </Tabs>
    </Layout>
  )
}

export default List
