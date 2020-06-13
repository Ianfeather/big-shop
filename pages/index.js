import styles from './index.module.css';
import useFetch from 'use-http'
import { useState, useEffect } from 'react';
import Layout from '@components/Layout'

const Index = ({ title, description, ...props }) => {

  let [recipes, setRecipes] = useState([]);

  // let shoppingList12 = {"recipes":[{"name":"Shepherds Pie","id":1,"ingredients":[{"name":"potato","unit":"kilogram","quantity":"1"},{"name":"minced beef","unit":"gram","quantity":"800"},{"name":"onion","unit":"","quantity":"1"},{"name":"carrot","unit":"","quantity":"1"},{"name":"garlic","unit":"clove","quantity":"2"},{"name":"Worcestershire Sauce","unit":"tablespoon","quantity":"2"},{"name":"Tomato Puree","unit":"tablespoon","quantity":"1"},{"name":"Thyme","unit":"","quantity":"1"},{"name":"Rosemary","unit":"","quantity":"1"},{"name":"Chicken Stock","unit":"millilitre","quantity":"300"}]},{"name":"Spaghetti Bolognese","id":2,"ingredients":[{"name":"Spaghetti","unit":"gram","quantity":"200"},{"name":"minced beef","unit":"gram","quantity":"500"},{"name":"Tinned Tomatoes","unit":"","quantity":"1"},{"name":"onion","unit":"","quantity":"1"},{"name":"garlic","unit":"clove","quantity":"3"},{"name":"Tomato Puree","unit":"tablespoon","quantity":"2"},{"name":"Beef Stock","unit":"millilitre","quantity":"200"},{"name":"Mushrooms","unit":"gram","quantity":"150"}]}],"list":{"Beef Stock":{"unit":"millilitre","quantity":200},"Chicken Stock":{"unit":"millilitre","quantity":300},"Mushrooms":{"unit":"gram","quantity":150},"Rosemary":{"unit":"","quantity":1},"Spaghetti":{"unit":"gram","quantity":200},"Thyme":{"unit":"","quantity":1},"Tinned Tomatoes":{"unit":"","quantity":1},"Tomato Puree":{"unit":"tablespoon","quantity":3},"Worcestershire Sauce":{"unit":"tablespoon","quantity":2},"carrot":{"unit":"","quantity":1},"garlic":{"unit":"clove","quantity":5},"minced beef":{"unit":"kilogram","quantity":1.3},"onion":{"unit":"","quantity":2},"potato":{"unit":"kilogram","quantity":1}}}

  let [recipeList, setRecipeList] = useState({});
  let [shoppingList, setShoppingList] = useState({});

  const handleRecipeSelect = (e) => {
    const newList = { ...recipeList,
      [e.target.id]: !recipeList[e.target.id]
    };
    setRecipeList(newList);
  };

  const { get, response, loading, error } = useFetch('/.netlify/functions/big-shop')

  async function getRecipes() {
    const recipes = await get('/recipes')
    if (response.ok) setRecipes(recipes)
  };

  async function getShoppingList() {
    const recipeIds = Object.keys(recipeList).filter(k => !!recipeList[k]).join(',');
    const { list } = await get(`/shopping-list?recipes=${recipeIds}`);
    if (response.ok) setShoppingList(list)
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
                  return (
                    <li className={styles.item} key={name}>
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
