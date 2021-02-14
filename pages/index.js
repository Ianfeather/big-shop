import styles from './index.module.css';
import useFetch from 'use-http'
import { useState, useEffect } from 'react';
import Layout from '@components/layout'
import { useAuth0 } from "@auth0/auth0-react";
import Logout from '@components/identity/logout';
import RecipeList from '@components/shopping-list/Recipes';
import ShoppingList from '@components/shopping-list/ShoppingList';

const Index = ({ title, description, ...props }) => {
  let [recipes, setRecipes] = useState([]);
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

  const { get, post, patch, del, response, loading, error } = useFetch(process.env.NEXT_PUBLIC_API_HOST, {
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
  async function getRecipes() {
    const recipes = await get('/recipes')
    if (response.ok) setRecipes(recipes)
  };

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
  };

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
  useEffect(() => { getRecipes() }, []);
  useEffect(() => { getShoppingList() }, [recipeList]);

  return (
    <Layout pageTitle={title} description={description}>
      <section>
        <Logout />
        <div className={styles.grid}>
          <RecipeList recipeList={recipeList} recipes={recipes} handleRecipeSelect={handleRecipeSelect}/>
          <div>
            <h2>Your shopping list</h2>
            <ShoppingList shoppingList={shoppingList} extras={extras} addExtraItem={addExtraItem} buyIngredient={buyIngredient} clearList={clearList} />
          </div>
        </div>
      </section>
    </Layout>
  )
}

export default Index

export async function getStaticProps() {
  const configData = (await import(`../siteconfig.json`)).default;

  return {
    props: {
      title: configData.title,
      description: configData.description,
    },
  }
}
