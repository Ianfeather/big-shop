import styles from './index.module.css';
import useFetch from 'use-http'
import { useState, useEffect } from 'react';
import { useAuth0 } from "@auth0/auth0-react";
import Layout, { MainContent, Sidebar } from '@components/layout'
import Tabs from '@components/layout/Tabs'
import RecipeSidebar from '@components/shopping-list/Recipes';
import ShoppingList from '@components/shopping-list/ShoppingList';
import useRecipes from '@hooks/use-recipes';
import useInterval from '@hooks/use-interval';

const List = () => {
  const [recipes] = useRecipes();
  let [recipeList, setRecipeList] = useState({});
  let [shoppingList, setShoppingList] = useState({});
  let [extras, setExtras] = useState({});
  let [hydrateFlag, setHydrateFlag] = useState(false);
  const { user } = useAuth0();

  const handleRecipeSelect = (e) => {
    const newList = { ...recipeList,
      [e.target.id]: !recipeList[e.target.id]
    };
    setRecipeList(newList);
  };

  const { get, post, patch, del, response } = useFetch(process.env.NEXT_PUBLIC_API_HOST, {
    cachePolicy: 'no-cache'
  });

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
    // fire and forget
    patch('/shopping-list/buy', { name, isBought: newList[name].isBought });
  }

  const setListState = (ingredients, extras) => {
    setShoppingList(ingredients);
    setExtras(extras);
  }

  const getListState = async () => {
    const result = await get('/shopping-list');
    if (response.ok && result.recipes.length) {
      setListState(result.ingredients, result.extras);
      return result;
    }
  }

  // This will only run once on load
  async function hydrateShoppingList() {
    const { recipes } = await getListState();
    setHydrateFlag(true);
    setRecipeList(recipes.reduce((acc, recipe) => {
      acc[recipe] = true;
      return acc;
    }, {}));
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
    const result = await post('/shopping-list', selectedRecipes);
    if (response.ok) {
      setListState(result.ingredients, result.extras);
    }
  }

  async function clearList() {
    setShoppingList({});
    setExtras({});
    setRecipeList([]);
    del('/shopping-list/clear');
  }

  function addExtraItem(extraItem) {
    if (!extraItem) { return; }
    const newList = {
      ...extras,
      [extraItem]: { quantity: '', unit: '' }
    };
    setExtras(newList);
    post('/shopping-list/extra', {
      name: extraItem,
      isBought: false
    });
  }

  function addUserAccount() {
    const appState = localStorage.getItem('app_state');
    if (!appState) return;
    if (appState === 'login') {
      let { name, email } = user;
      post('/user', { name, email });
      localStorage.removeItem('app_state');
    }
  }

  useEffect(() => { hydrateShoppingList() }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { getShoppingList() }, [recipeList]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { addUserAccount() }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  // poll for list updates
  useInterval(getListState, 5000);

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
