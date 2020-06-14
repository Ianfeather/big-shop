import styles from './form.module.css';
import { useState, useEffect } from 'react';
import useFetch from 'use-http'

export default function Form() {
  let [recipe, setRecipe] = useState({});
  let [saved, setSaved] = useState(false);

  const bareIngredient = { name: '', quantity: '', unit: '' };
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

  async function submitRecipe(e) {
    e.preventDefault();
    const completeRecipe = { ...recipe, ingredients: ingredients.filter(({name}) => !!name)};
    const result = await post('/recipe', completeRecipe)
    if (response.ok) {
      setSaved(true);
    }
  }

  function deleteIngredient(e) {
    e.preventDefault();
    console.log(e.target.id)
    const newIngredients = ingredients.filter((_, idx) => {
      console.log(idx, e.target.id)
      return idx !== Number(e.target.id)
    });
    console.log(newIngredients);
    setIngredients(newIngredients);
  }

  return (
    <>
    <form className={styles.form}>
      <div className={styles.group}>
        <label htmlFor="recipe-name">Recipe Name</label>
        <input autoComplete="off" type="text" id="recipe-name" onChange={(e) => updateRecipe('name', e.target.value)}/>
      </div>
      <div className={styles.group}>
        <label htmlFor="recipe-remote-url">URL (to the recipe site, optional)</label>
        <input autoComplete="off" type="text" id="recipe-remote-url" onChange={(e) => updateRecipe('remote_url', e.target.value)}/>
      </div>

      <h2>Ingredients</h2>
      {
        ingredients.map((ingredient, i) => (
          <div className={styles.ingredientGroup} key={i}>
            <div className={styles.ingredientName}>
              <label htmlFor="ingredient-name">Ingredient Name</label>
              <input value={ingredient.name} autoComplete="off" type="text" id="ingredient-name" onChange={(e) => updateIngredient(i, 'name', e.target.value)}/>
            </div>
            <div>
              <label htmlFor="ingredient-quantity">Quantity</label>
              <input value={ingredient.quantity} autoComplete="off" type="text" id="ingredient-quantity" onChange={(e) => updateIngredient(i, 'quantity', e.target.value)} />
            </div>
            <div className={styles.unit}>
              <label htmlFor="ingredient-unit">Unit</label>
              <select className={styles.ingredientUnit} onChange={(e) => updateIngredient(i, 'unit', e.target.value)} value={ingredient.unit}>
                {
                  units.map(({ id, name}) => (
                    <option key={id} id={id}>{name}</option>
                  ))
                }
              </select>
            </div>
            {

              i > 0 && (
                <div>
                  <label htmlFor="ingredient-delete">Delete</label>
                  <button className={styles.trash} aria-label="trash" id={i} onClick={deleteIngredient}>×</button>
                </div>
              )
            }
          </div>
        ))
      }
      <button className={`${styles.button} ${loading ? styles.loading : ''}`} onClick={submitRecipe}>Store Recipe</button>
      { saved && <div className={styles.stored}>Stored!</div> }
    </form>
    </>
  )
}
