import styles from './index.module.css';
import useFetch from 'use-http'
import { useState, useEffect } from 'react';
import Layout from '@components/layout'

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

  const { get, post, patch, del, response, loading, error } = useFetch('/.netlify/functions/big-shop')

  async function buyIngredients(name, type) {
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
    const { recipes, ingredients, extras } = await get('/shopping-list');
    if (response.ok && recipes.length) {
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
    const { recipes, ingredients, extras } = await post('/shopping-list', selectedRecipes);
    if (response.ok) {
      setShoppingList(ingredients);
      setExtras(extras);
    }
  };

  async function clearList() {
    setShoppingList({});
    setExtras({});
    setRecipes([]);
    del('/shopping-list/clear');
    // TODO: handle sync fail
  }

  function addListItem(e) {
    if (e.which !== 13) {
      return;
    }
    const newList = {
...extras,
      [e.target.value]: {
        quantity: '',
        unit: ''
      }
    };
    setExtras(newList);
    // fire and forget
    post('/shopping-list/extra', {
      name: e.target.value,
      isBought: false
    });
    if (response.error || error) {
      // TODO: handle sync fail
    };
    e.target.value = '';
  }

  useEffect(() => { hydrateShoppingList() }, []);
  useEffect(() => { getRecipes() }, []);
  useEffect(() => { getShoppingList() }, [recipeList]);

  return (
    <Layout pageTitle={title} description={description}>
      <section>
        <div className={styles.grid}>
          <div className={styles.recipeList}>
            <h2>Recipes</h2>
            <ul>
              {
                recipes.map(({id, name}) => {
                  let checked = recipeList[id];
                  return (
                    <li key={id} className={checked ? styles.checked : ''}>
                      <label htmlFor={id}>
                        {name}
                        <input type="checkbox" id={id} className={styles.hidden} onChange={handleRecipeSelect}/>
                      </label>
                    </li>
                  );
                })
              }
            </ul>
          </div>
          <div>
            <h2>Your shopping list</h2>
            <div className={styles.shoppingList}>
              {
                Object.keys(shoppingList).length == 0 && (
                  <p className={styles.emptyList}>Select a recipe from the list to get started.</p>
                )
              }
              <ul>
                {
                  Object.keys(shoppingList)
                    .filter((name => !shoppingList[name].isBought))
                    .map(name => {
                      const { unit, quantity } = shoppingList[name];
                      return (
                        <li className={styles.item} key={name} onClick={() => buyIngredients(name, 'ingredient')}>
                          <span className={styles.itemName}>{name}</span>
                          <span className={styles.itemQuantity}>{quantity}</span>
                          <span className={styles.itemUnit}>{unit}</span>
                        </li>
                      )
                    })
                }
                {
                  Object.keys(extras)
                    .filter((name => !extras[name].isBought))
                    .map(name => (
                      <li className={styles.item} key={name} onClick={() => buyIngredients(name, 'extra')}>
                        <span className={styles.itemName}>{name}</span>
                        <span className={styles.itemQuantity}></span>
                        <span className={styles.itemUnit}></span>
                      </li>
                    )
                  )
                }
              </ul>
              <div>
                <label className={styles.extraListLabel} htmlFor="extra-list-item">Add non-recipe items:</label>
                <input className={styles.extraListInput} autoComplete="off" type="text" id="extra-list-item" onKeyPress={addListItem} />
                {/* TODO: Add button */}
              </div>
              {
                Object.keys(shoppingList).length > 0 && (
                  <>
                    <h2>Already bought</h2>
                    <ul className={styles.shoppingList}>
                      {
                        Object.keys(shoppingList)
                          .filter((name => shoppingList[name].isBought))
                          .map(name => {
                            const { unit, quantity } = shoppingList[name];
                            return (
                              <li className={`${styles.item} ${styles.checked}`} key={name} onClick={() => buyIngredients(name, 'ingredient')}>
                                <span className={styles.itemName}>{name}</span>
                                <span className={styles.itemQuantity}>{quantity}</span>
                                <span className={styles.itemUnit}>{unit}</span>
                              </li>
                            )
                          })
                      }
                      {
                        Object.keys(extras)
                          .filter((name => extras[name].isBought))
                          .map(name => (
                              <li className={`${styles.item} ${styles.checked}`} key={name} onClick={() => buyIngredients(name, 'extra')}>
                                <span className={styles.itemName}>{name}</span>
                                <span className={styles.itemQuantity}></span>
                                <span className={styles.itemUnit}></span>
                              </li>
                            )
                          )
                      }
                    </ul>
                  </>
                )
              }
              {
                Object.keys(shoppingList).length > 0 && (
                  <button className={styles.button} onClick={() => clearList()}>Clear list</button>
                )
              }
            </div>
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
