import styles from './index.module.css';
import useFetch from 'use-http'
import { useState, useEffect } from 'react';
import Layout from '@components/layout'

const Index = ({ title, description, ...props }) => {
  let [recipes, setRecipes] = useState([]);
  let [recipeList, setRecipeList] = useState({});
  let [shoppingList, setShoppingList] = useState({});
  let [checkedIngredients, setCheckedIngredients] = useState({});

  const handleRecipeSelect = (e) => {
    const newList = { ...recipeList,
      [e.target.id]: !recipeList[e.target.id]
    };
    setRecipeList(newList);
  };

  const handleCheckedIngredients = (name) => {
    const newList = { ...checkedIngredients,
      [name]: !checkedIngredients[name]
    };
    setCheckedIngredients(newList);
  }

  const { get, response, loading, error } = useFetch('/.netlify/functions/big-shop')

  async function getRecipes() {
    const recipes = await get('/recipes')
    if (response.ok) setRecipes(recipes)
  };

  async function getShoppingList() {
    const selectedRecipes = Object.keys(recipeList).filter(k => !!recipeList[k]);
    if (selectedRecipes.length) {
      const recipeIds = selectedRecipes.join(',');
      const { list } = await get(`/shopping-list?recipes=${recipeIds}`);
      if (response.ok) setShoppingList(list);
      if (response.error || error) setShoppingList({});
    } else {
      setShoppingList({});
    }
  };

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
            <ul className={styles.shoppingList}>
              {
                Object.keys(shoppingList).map(name => {
                  const { unit, quantity } = shoppingList[name];
                  const isChecked = !!checkedIngredients[name];
                  return (
                    <li className={`${styles.item} ${isChecked ? styles.checked : ''}`} key={name} onClick={() => handleCheckedIngredients(name)}>
                      <span className={styles.itemName}>{name}</span>
                      <span className={styles.itemQuantity}>{quantity}</span>
                      <span className={styles.itemUnit}>{unit}</span>
                    </li>
                  )
                })
              }
            </ul>
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
