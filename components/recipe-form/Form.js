import styles from './form.module.css';
import { useState, useEffect } from 'react';
import useFetch from 'use-http'

export default function Form() {
  let [recipe, setRecipe] = useState({});
  let [saved, setSaved] = useState(false);

  const bareIngredient = { name: null, quantity: null, unit: null };
  let [ingredients, setIngredients] = useState([bareIngredient]);
  let [units, setUnits] = useState([{name:'g', id:1}, {name:'kg', id:2}]);

  const { get, post, response, loading, error } = useFetch('/.netlify/functions/big-shop')

  async function getUnits() {
    const units = await get('/units')
    if (response.ok) setUnits(units)
  };

  useEffect(() => { getUnits() }, []);

  function updateRecipe(key, value) {
    const updatedRecipe = { ...recipe, [key]: value};
    setRecipe(updatedRecipe)
  }

  function updateIngredient(i, key, value) {
    let newIngredients = [...ingredients];
    newIngredients[i][key] = value;
    if (i === ingredients.length - 1) {
      newIngredients.push(bareIngredient);
    }
    setIngredients(newIngredients);
  }

  async function submitRecipe() {
    const completeRecipe = { ...recipe, ingredients: ingredients.filter(({name}) => !!name)};
    const result = await post('/recipe', completeRecipe)
    if (response.ok) {
      setSaved(true);
    }
  }

  return (
    <>
    <form>
      <div className={styles.group}>
        <label htmlFor="recipe-name">Recipe Name</label>
        <input type="text" id="recipe-name" onChange={(e) => updateRecipe('name', e.target.value)}/>
      </div>
      <div className={styles.group}>
        <label htmlFor="recipe-remote-url">Import from url</label>
        <input type="text" id="recipe-remote-url" onChange={(e) => updateRecipe('remote_url', e.target.value)}/>
      </div>

      <h2>Ingredients</h2>
      {
        ingredients.map((ingredient, i) => (
          <div className={styles.ingredientGroup} key={i}>
            <div>
              <label htmlFor="ingredient-name">Ingredient</label>
              <input type="text" id="ingredient-name" onChange={(e) => updateIngredient(i, 'name', e.target.value)}/>
            </div>
            <div>
              <label htmlFor="ingredient-quantity">Quantity</label>
              <input type="text" id="ingredient-quantity" onChange={(e) => updateIngredient(i, 'quantity', e.target.value)} />
            </div>
            <div>
              <label htmlFor="ingredient-unit">Unit</label>
              <select onChange={(e) => updateIngredient(i, 'unit', e.target.value)} value={ingredient.unit}>
                {
                  units.map(({ id, name}) => (
                    <option id={id}>{name}</option>
                  ))
                }
              </select>
            </div>
          </div>
        ))
      }
      <button onClick={submitRecipe}>Store Recipe</button>
      { loading && <div>Loading...</div> }
      { saved && <div>Saved!</div> }
      { error && <div>Error :(</div> }
    </form>
    <div>{JSON.stringify(recipe)}</div>
    <div>{JSON.stringify(ingredients)}</div>
    </>
  )
}
