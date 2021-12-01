import styles from './index.module.css';
import useFetch from 'use-http'
import { useState, useEffect } from 'react';
import Layout, { MainContent, Sidebar } from '@components/layout'
import Tabs from '@components/layout/Tabs'
import Logout from '@components/identity/logout';
import RecipeSidebar from '@components/shopping-list/Recipes';
import ShoppingList from '@components/shopping-list/ShoppingList';
import useRecipes from '@hooks/use-recipes';

const List = () => {
  const [recipes] = useRecipes();
  let [recipeList, setRecipeList] = useState({});
  let [shoppingList, setShoppingList] = useState({});
  let [extras, setExtras] = useState({});
  let [hydrateFlag, setHydrateFlag] = useState(false);

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

  // This will only run once on load
  async function hydrateShoppingList() {
    const result = await get('/shopping-list');
    if (response.ok && result.recipes.length) {
      const { recipes, ingredients, extras } = result;
      setHydrateFlag(true);
      setRecipeList(recipes.reduce((acc, recipe) => {
        acc[recipe] = true;
        return acc;
      }, {}));
      setShoppingList(ingredients);
      setExtras(extras);
    }
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
      setShoppingList(result.ingredients);
      setExtras(result.extras);
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

  useEffect(() => { hydrateShoppingList() }, []);
  useEffect(() => { getShoppingList() }, [recipeList]);

  return (
    <Layout>
      <Tabs buttonsClassName={styles.tabButtons} maxWidth={800}>
        <MainContent name="Shopping List">
          <ShoppingList shoppingList={shoppingList} extras={extras} buyIngredient={buyIngredient} />
        </MainContent>
        <Sidebar name="Create & Edit">
          <RecipeSidebar recipeList={recipeList} addExtraItem={addExtraItem} clearList={clearList} recipes={recipes} handleRecipeSelect={handleRecipeSelect}/>
        </Sidebar>
      </Tabs>
      <Logout className={styles.logOut} />
    </Layout>
  )
}

export default List
