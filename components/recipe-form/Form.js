import styles from './form.module.css';
import { useState, useEffect } from 'react';
import useFetch from 'use-http'
import { useRouter } from 'next/router'
import { Typeahead } from 'react-typeahead';
import Button from '@components/button';
import partition from 'just-partition';
import Spinner from './spinner';

const bareIngredient = { name: '', quantity: '', unit: '' };

const capitalize = (str) => {
  if (!str) {
    return str;
  }
  const [first, ...rest] = str;
  return [first.toUpperCase(), ...rest].join('');
}

export default function Form({initialRecipe = {}, mode = 'new'}) {
  const bareRecipe = { name: '', remoteUrl: '', notes: '', ingredients: [{...bareIngredient}]};

  let [recipe, setRecipe] = useState(initialRecipe.id ? initialRecipe : bareRecipe);
  let [saved, setSaved] = useState(false);
  let [units, setUnits] = useState([]);
  let [tags, setTags] = useState([]);
  let [ingredients, setIngredients] = useState([]);
  let [deleted, setDeleted] = useState(false);
  let [showIngredients, setShowIngredients] = useState(mode != 'new');
  let [autoIngredients, setAutoIngredients] = useState(mode === 'new');
  let [unmatchedIngredients, setUnmatchedIngredients] = useState([]);
  const router = useRouter();
  const { get, post, put, del, response, loading } = useFetch(process.env.NEXT_PUBLIC_API_HOST, {
    cachePolicy: 'no-cache'
  });

  const { get: getNextAPI, response: nextAPIResponse, loading: nextAPILoading } = useFetch(process.env.NEXT_PUBLIC_HOST, {
    cachePolicy: 'no-cache'
  });

  useEffect(() => {
    if (initialRecipe.name) {
      setRecipe({
        ...initialRecipe,
        ingredients: [ ...initialRecipe.ingredients, {...bareIngredient} ]
      });
    }
  }, [initialRecipe]);

  async function getUnitsTagsAndIngredients() {
    const [_units, _tags, _ingredients] = await Promise.all([
      get('/units'),
      get('/tags'),
      get('/ingredients')
    ]);
    if (response.ok) {
      setUnits(_units.map(unit => ({...unit, name: capitalize(unit.name)})));
      setTags(tags);
      setIngredients(_ingredients.map(i => capitalize(i.name)));
    }

  }
  useEffect(() => { getUnitsTagsAndIngredients() }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function updateRecipe(key, value) {
    const updatedRecipe = { ...recipe, [key]: value};
    setRecipe(updatedRecipe)
  }

  function updateRecipeTags(value) {
    const exists = recipe.tags.some(tag => tag.name === value);
    let newTags;
    if (exists) {
      newTags = recipe.tags.filter(tag => tag.name != value)
    } else {
      newTags = [...recipe.tags, tags.find(t => t.name === value)]
    }
    const updatedRecipe = { ...recipe, tags: newTags};
    setRecipe(updatedRecipe)
  }

  function updateIngredient(i, key, value) {
    let newIngredients = [...recipe.ingredients];
    newIngredients[i][key] = value;
    if (i === recipe.ingredients.length - 1) {
      newIngredients.push({...bareIngredient});
    }
    setRecipe({
      ...recipe,
      ingredients: newIngredients
    });
  }

  async function submitRecipe(e) {
    e.preventDefault();
    const completeRecipe = { ...recipe, ingredients: recipe.ingredients.filter(({name}) => !!name)};
    if (mode === 'edit') {
      await put('/recipe', completeRecipe)
    } else {
      await post('/recipe', completeRecipe)
    }
    if (response.ok) {
      setSaved(true);
    }
  }

  async function deleteRecipe(e) {
    e.preventDefault();
    await del('/recipe', { id: recipe.id })
    if (response.ok) {
      setDeleted(true);
      return router.push('/recipes')
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

  function resetForm(e) {
    e.preventDefault();
    setRecipe(bareRecipe);
    setUnmatchedIngredients([]);
  }

  async function onNext(e) {
    e.preventDefault();
    if (recipe.remoteUrl && autoIngredients) {
      const ingredients = await getNextAPI(`/api/get-ingredients?url=${encodeURIComponent(recipe.remoteUrl)}`);
      if (nextAPIResponse.ok) {
        const [matched, unmatched] = partition(ingredients, ingredient => {
          if (!(ingredient.name && ingredient.quantity)) return false;
          if (!ingredient.unit) return true; // we're fine with null units
          return units.some(unit => unit.name.toLowerCase() === ingredient.unit.toLowerCase())
        });
        setRecipe({
          ...recipe,
          ingredients: [...matched, {...bareIngredient}]
        });
        setUnmatchedIngredients(unmatched);
      }
    }
    setShowIngredients(true);
  }

  if (mode === 'edit' && !recipe.id) {
    return false;
  }

  return (
    <>
    <form className={styles.form}>
      <div className={styles.metaGroup}>
        <div className={styles.group}>
          <label htmlFor="recipe-name">Recipe Name <span className={styles.required}>*</span></label>
          <input placeholder="Shepherds Pie" value={recipe.name} autoComplete="off" type="text" id="recipe-name" onChange={(e) => updateRecipe('name', e.target.value)}/>
        </div>
        <div className={styles.group}>
          <label htmlFor="recipe-remote-url">Link to the original recipe</label>
          <input placeholder="https://" value={recipe.remoteUrl} autoComplete="off" type="text" id="recipe-remote-url" onChange={(e) => updateRecipe('remoteUrl', e.target.value)}/>
        </div>
        <div className={styles.group}>
          <label htmlFor="recipe-remote-url">Tags</label>
          {
            tags.map((tag, idx) => (
              <div key={tag.name}>
                <input
                  type="checkbox"
                  value={tag.name.toLowerCase()}
                  id={`tag-${idx}`}
                  checked={recipe.tags.some(t => t.name === tag.name)}
                  onChange={(e) => updateRecipeTags(e.target.value)}
                  />
                <label for={`tag-${idx}`}>{tag.name}</label>
              </div>
            ))
          }
        </div>
        <div className={styles.group}>
          <label htmlFor="recipe-remote-url">Notes</label>
          <textarea placeholder="Go heavy on the pepper" value={recipe.notes} autoComplete="off" id="recipe-notes" rows="3" onChange={(e) => updateRecipe('notes', e.target.value)}/>
        </div>
        {
          recipe.remoteUrl && (
            <div className={styles.checkboxContainer}>
                <input type="checkbox" checked={autoIngredients} id="recipe-auto-ingredients" onChange={(e) => setAutoIngredients(!autoIngredients)}/>
                <label htmlFor="recipe-auto-ingredients">Attempt to auto-fill ingredients</label>
              </div>
          )
        }


      </div>

      {
        showIngredients ? (
          <>
            { autoIngredients && !!unmatchedIngredients.length && (
              <div className={styles.unmatchedIngredients}>
                <div className={styles.unmatchedHeading}>The following ingredients were also found which you should add manually to avoid mistakes.</div>
                <ul>
                  { unmatchedIngredients.map((ig, i) => <li key={i}>{ig.text}</li>) }
                </ul>
              </div>
            )}

            <div className={styles.ingredientsGroup}>
              {
                recipe.ingredients.map((ingredient, i) => {
                  return (
                    <div className={styles.ingredientGroup} key={i}>
                      <div className={styles.ingredientName}>
                        <label htmlFor={`ingredient-name-${i}`} className={i != 0 ? styles.srOnly: ''}>Ingredient</label>
                        <Typeahead
                          options={ingredients}
                          maxVisible={3}
                          placeholder="Ingredient"
                          id={`ingredient-name-${i}`}
                          autoComplete="off"
                          value={ingredient.name}
                          onChange={(e) => updateIngredient(i, 'name', e.target.value)}
                          onOptionSelected={(value) => updateIngredient(i, 'name', value)} />
                      </div>

                      <div className={styles.ingredientQuantity}>
                        <label htmlFor={`ingredient-quantity-${i}`} className={i != 0 ? styles.srOnly : ''}>Quantity</label>
                        <input placeholder="Quantity" value={ingredient.quantity} autoComplete="off" type="text" id={`ingredient-quantity-${i}`} onChange={(e) => updateIngredient(i, 'quantity', e.target.value)} />
                      </div>

                      <div className={styles.unit}>
                        <label htmlFor={`ingredient-unit-${i}`} className={i != 0 ? styles.srOnly : ''}>Unit</label>
                        <select id={`ingredient-unit-${i}`} className={styles.ingredientUnit} onChange={(e) => updateIngredient(i, 'unit', e.target.value)} value={ingredient.unit.toLowerCase()}>
                          {
                            units.map(({ id, name}) => (
                              <option key={id} id={id} value={name.toLowerCase()}>{name}</option>
                            ))
                          }
                        </select>
                      </div>

                      <div className={styles.deleteColumn}>
                        {
                          i > 0 && (
                            <>
                              <label className={i != 0 ? styles.srOnly : ''}>Delete</label>
                              <button className={styles.trash} aria-label="trash" id={i} onClick={deleteIngredient}>×</button>
                            </>
                          )
                        }
                      </div>

                    </div>
                  )
                })
              }
            </div>
            <div className={styles.buttonContainer}>
              <Button style="green" icon="tick" className={`${loading ? styles.loading : ''}`} onClick={submitRecipe}>
                { mode === 'edit' ? 'Update Recipe' : 'Store Recipe'}
              </Button>

              { saved && (
                <>
                  <div className={styles.stored}>
                    { mode === 'edit' ? 'Updated!' : 'Stored!'}
                  </div>
                  { mode === 'new' &&
                    <div>
                      <Button className={`${styles.addAnotherRecipe}`} onClick={resetForm}>
                        Add another recipe
                      </Button>
                    </div>
                  }
                </>
              )}
              {
                mode === 'edit' && (
                  <div>
                    <Button style="red" icon="trash" onClick={deleteRecipe}>Delete Recipe</Button>
                    {
                      deleted && <span>Deleted</span>
                    }
                  </div>
                )
              }
            </div>
          </>
        ) :
        (
          <>
            <Button style="green" onClick={onNext}>
              Next: Add Ingredients
              { !!nextAPILoading && <Spinner className={styles.loadingIngredients}>Loading...</Spinner>}
            </Button>
          </>
        )
      }
    </form>
    </>
  )
}
