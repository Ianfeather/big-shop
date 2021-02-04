import styles from './index.module.css';
import useFetch from 'use-http'
import { useState, useEffect } from 'react';
import Layout from '@components/layout'

const Index = ({ title, description, ...props }) => {
  let [recipes, setRecipes] = useState([]);
  let [recipeList, setRecipeList] = useState({});
  let [shoppingList, setShoppingList] = useState({});
  let [extras, setExtras] = useState({});
  let [extraItem, setExtraItem] = useState('');
  let [hydrateFlag, setHydrateFlag] = useState(false);
  let [sidebarFilter, setSidebarFilter] = useState('');
  const handleRecipeSelect = (e) => {
    const newList = { ...recipeList,
      [e.target.id]: !recipeList[e.target.id]
    };
    setRecipeList(newList);
  };

  const { get, post, patch, del, response, loading, error } = useFetch(process.env.NEXT_PUBLIC_API_HOST);

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
    setRecipeList([]);
    del('/shopping-list/clear');
    // TODO: handle sync fail
  }

  function addExtraItem() {
    if (!extraItem) {
      return;
    }
    const newList = {
      ...extras,
      [extraItem]: {
        quantity: '',
        unit: ''
      }
    };
    setExtras(newList);
    // fire and forget
    post('/shopping-list/extra', {
      name: extraItem,
      isBought: false
    });
    if (response.error || error) {
      // TODO: handle sync fail
    };
    setExtraItem('');
  }

  function addExtraItemOnEnter(e) {
    if (e.which !== 13) {
      return;
    }
    addExtraItem();
  }

  useEffect(() => { hydrateShoppingList() }, []);
  useEffect(() => { getRecipes() }, []);
  useEffect(() => { getShoppingList() }, [recipeList]);

  return (
    <Layout pageTitle={title} description={description}>
      <section>
        <div className={styles.grid}>
          <div>
            <h2>Recipes</h2>
            <input className={styles.filterInput} placeholder="Filter recipes..." type="text" onChange={(e) => setSidebarFilter(e.target.value)} value={sidebarFilter} />
            <div className={styles.recipeList}>
              <ul>
                {
                  recipes
                    .filter(({ name }) => name.toLowerCase().includes(sidebarFilter.toLowerCase()))
                    .map(({id, name}) => {
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
                    .sort((_a, _b) => {
                      let a = shoppingList[_a];
                      let b = shoppingList[_b];
                      if (a.department === b.department) {
                        console.log(`${_a} === ${_b} - skipping`)
                        return 0;
                      }
                      if (!b.department) {
                        console.log(`${_b} has no deparment - lowering`)
                        return -1;
                      }
                      if (b.department === 'vegetables') {
                        console.log(`${b.department} (${_b}) is vegetables - promoting`)
                        return 1;
                      }
                      if (a.department === 'vegetables') {
                        console.log(`${b.department} (${_b}) is not vegetables - demoting`)
                        return -1;
                      }
                      console.log("no match");
                    })
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
                <div className={styles.extraListContainer}>
                  <input className={styles.extraListInput} autoComplete="off" type="text" id="extra-list-item" value={extraItem} onKeyPress={addExtraItemOnEnter} onChange={(e) => setExtraItem(e.target.value)} />
                  <button onClick={addExtraItem} className={styles.button}>Add</button>
                </div>
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
                          .filter((name => extras[name].isBought))
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
                  </>
                )
              }
              {
                Object.keys(shoppingList).length > 0 && (
                  <button className={`${styles.button} ${styles.clearList}`} onClick={() => clearList()}>Clear list</button>
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
