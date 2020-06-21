import styles from './form.module.css';
import { useState, useEffect } from 'react';
import useFetch from 'use-http'
import { Typeahead } from 'react-typeahead';


export default function Form({initialRecipe = {}}) {
  const bareIngredient = { name: '', quantity: '', unit: '' };
  const bareRecipe = { ingredients: [bareIngredient]};

  let [recipe, setRecipe] = useState(initialRecipe.name ? initialRecipe : bareRecipe);
  let [saved, setSaved] = useState(false);
  let [units, setUnits] = useState([]);
  let [ingredients, setIngredients] = useState([]);

  const { get, post, put, response, loading, error } = useFetch('/.netlify/functions/big-shop')

  useEffect(() => {
    if (initialRecipe.name) {
      setRecipe({
        ...initialRecipe,
        ingredients: [ ...initialRecipe.ingredients, bareIngredient ]
      });
    }
  }, [initialRecipe]);

  async function getUnitsAndIngredients() {
    const [_units, _ingredients] = await Promise.all([
      get('/units'),
      get('/ingredients')
    ]);
    if (response.ok) {
      setUnits(_units)
      setIngredients(_ingredients.map(i => i.name))
    }
  };
  useEffect(() => { getUnitsAndIngredients() }, []);

  function updateRecipe(key, value) {
    const updatedRecipe = { ...recipe, [key]: value};
    setRecipe(updatedRecipe)
  }

  function updateIngredient(i, key, value) {
    console.log("Updating: ", value);
    let newIngredients = [...recipe.ingredients];
    newIngredients[i][key] = value;
    if (i === recipe.ingredients.length - 1) {
      newIngredients.push(bareIngredient);
    }
    setRecipe({
      ...recipe,
      ingredients: newIngredients
    });
  }

  async function submitRecipe(e) {
    e.preventDefault();
    const completeRecipe = { ...recipe, ingredients: recipe.ingredients.filter(({name}) => !!name)};
    let result;
    if (recipe.id) {
      result = await put('/recipe', completeRecipe)
    } else {
      result = await post('/recipe', completeRecipe)
    }
    if (response.ok) {
      setSaved(true);
    }
  }

  function deleteIngredient(e) {
    e.preventDefault();
    setRecipe({
      ...recipe,
      ingredients: recipe.ingredients.filter((_, idx) => {
        return idx !== Number(e.target.id)
      })
    })
  }

  return (
    <>
    <form className={styles.form}>
      <div className={styles.group}>
        <label htmlFor="recipe-name">Recipe Name</label>
        <input value={recipe.name} autoComplete="off" type="text" id="recipe-name" onChange={(e) => updateRecipe('name', e.target.value)}/>
      </div>
      <div className={styles.group}>
        <label htmlFor="recipe-remote-url">URL (to the recipe site, optional)</label>
        <input value={recipe.remoteUrl} autoComplete="off" type="text" id="recipe-remote-url" onChange={(e) => updateRecipe('remoteUrl', e.target.value)}/>
      </div>

      <h2>Ingredients</h2>
      {
        recipe.ingredients.map((ingredient, i) => {
          console.log("ingredient")
          console.log(ingredient)
          return (
          <div className={styles.ingredientGroup} key={i}>
            <div className={styles.ingredientName}>
              <label htmlFor="ingredient-name">Ingredient Name</label>
              <Typeahead
                options={ingredients}
                maxVisible={3}
                value={ingredient.name}
                onChange={(e) => updateIngredient(i, 'name', e.target.value)}
                onOptionSelected={(value) => updateIngredient(i, 'name', value)} />
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
          )
        ))
      }
      <button className={`${styles.button} ${loading ? styles.loading : ''}`} onClick={submitRecipe}>
        { recipe.id ? 'Update Recipe' : 'Store Recipe'}
      </button>
      { saved && (
        <div className={styles.stored}>
          { recipe.id ? 'Updated!' : 'Stored!'}
        </div>
      )}
    </form>
    </>
  )
}
