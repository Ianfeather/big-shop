import styles from './form.module.css';
import { useState, useEffect } from 'react';
import useFetch from 'use-http'
import { useRouter } from 'next/router'
import Autosuggest from 'react-autosuggest';
import Button from '@components/button';
import Message from '@components/message';
import partition from 'just-partition';
import Spinner from './spinner';
import mocks from '../../mocks';

/*
Issues:
- Ingredients won't match and we get loads of similar ones
  -- need to prune the list

*/


const useMocks = true;

const capitalize = (str) => {
  if (!str) {
    return str;
  }
  const [first, ...rest] = str;
  return [first.toUpperCase(), ...rest].join('');
}

export default function Form({initialRecipe = {}, mode = 'new'}) {
  const bareRecipe = { name: '', remoteUrl: '', notes: '', ingredients: [], tags: []};

  let useInitialRecipe = Object.keys(initialRecipe).length > 0;
  let [recipe, setRecipe] = useState(useInitialRecipe ? initialRecipe : bareRecipe);
  let [saved, setSaved] = useState(false);
  let [units, setUnits] = useState([]);
  let [tags, setTags] = useState([]);
  let [ingredients, setIngredients] = useState([]);
  let [deleted, setDeleted] = useState(false);
  let [showIngredients, setShowIngredients] = useState(mode != 'new');
  let [autoIngredients, setAutoIngredients] = useState(mode === 'new');
  let [unmatchedIngredients, setUnmatchedIngredients] = useState([]);
  let [newIngredient, setNewIngredient] = useState('');
  let [suggestions, setSuggestions] = useState([]);

  const router = useRouter();
  const { get, post, put, del, response, loading, error } = useFetch(process.env.NEXT_PUBLIC_API_HOST, {
    cachePolicy: 'no-cache'
  });

  const { get: getNextAPI, response: nextAPIResponse, loading: nextAPILoading, error: nextAPIError } = useFetch(process.env.NEXT_PUBLIC_HOST, {
    cachePolicy: 'no-cache'
  });

  useEffect(() => {
    if (initialRecipe.name) {
      setRecipe(initialRecipe);
    }
  }, [initialRecipe]);

  async function getUnitsTagsAndIngredients() {
    if (useMocks) {
      setUnits(mocks.units.map(unit => ({...unit, name: capitalize(unit.name)})));
      setTags(mocks.tags);
      setIngredients(mocks.ingredients.map(i => i.name));
      return;
    }
    const [_units, _tags, _ingredients] = await Promise.all([
      get('/units'),
      get('/tags'),
      get('/ingredients')
    ]);
    if (response.ok) {
      setUnits(_units.map(unit => ({...unit, name: capitalize(unit.name)})));
      setTags(_tags);
      setIngredients(_ingredients.map(i => i.name));
    }

  }
  useEffect(() => { getUnitsTagsAndIngredients() }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function updateRecipe(key, value) {
    const updatedRecipe = { ...recipe, [key]: value};
    setRecipe(updatedRecipe)
  }

  function updateRecipeTags(value) {
    const exists = recipe.tags.includes(value);
    let newTags;
    if (exists) {
      newTags = recipe.tags.filter(tag => tag != value)
    } else {
      newTags = [...recipe.tags, tags.find(t => t === value)]
    }
    const updatedRecipe = { ...recipe, tags: newTags};
    setRecipe(updatedRecipe)
  }

  function addIngredient(e) {
    e.preventDefault();
    setRecipe(prevRecipe => ({
        ...prevRecipe,
        ingredients: [...prevRecipe.ingredients, { name: newIngredient, unit: '', quantity: '' }]
    }));
    setNewIngredient('');
  }

  function updateIngredient(i, key, value) {
    let newIngredients = [...recipe.ingredients];
    newIngredients[i][key] = value;
    setRecipe({
      ...recipe,
      ingredients: newIngredients
    });
  }

  async function submitRecipe(e) {
    e.preventDefault();
    if (mode === 'edit') {
      await put('/recipe', recipe)
    } else {
      await post('/recipe', recipe)
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

  function deleteIngredient(e, name) {
    e.preventDefault();
    setRecipe({
      ...recipe,
      ingredients: recipe.ingredients.filter(ingredient => ingredient.name !== name)
    })
  }

  function resetForm(e) {
    e.preventDefault();
    setRecipe(bareRecipe);
    setUnmatchedIngredients([]);
  }

  const getSuggestions = (value) => {
    const inputValue = value.trim().toLowerCase();
    if (inputValue.length < 2) return [];
    return ingredients.filter(ingredient => ingredient.toLowerCase().indexOf(inputValue) > -1);
  };

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
          ingredients: matched
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
              <div key={tag} className={styles.tagContainer}>
                <input
                  type="checkbox"
                  value={tag}
                  id={`tag-${idx}`}
                  checked={recipe.tags.includes(tag)}
                  onChange={(e) => updateRecipeTags(e.target.value)}
                  className={styles.tagCheckbox}
                  />
                <label htmlFor={`tag-${idx}`} className={styles.tagLabel}>{tag}</label>
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
        true ? (
          <>
            { autoIngredients && !!unmatchedIngredients.length && (
              <div className={styles.unmatchedIngredients}>
                <div className={styles.unmatchedHeading}>The following ingredients were also found which you should add manually to avoid mistakes.</div>
                <ul>
                  { unmatchedIngredients.map((ig, i) => <li key={i}>{ig.text}</li>) }
                </ul>
              </div>
            )}

            <div className={styles.addIngredientSection}>
              <div className={styles.addIngredientTitle}>Add ingredient</div>
              <div className={styles.addIngredientGroup}>
                <div className={styles.addIngredientInput}>
                  <Autosuggest
                    suggestions={suggestions}
                    onSuggestionsFetchRequested = {e => setSuggestions(getSuggestions(e.value))}
                    onSuggestionsClearRequested={() => setSuggestions([])}
                    getSuggestionValue = {(suggestion) => suggestion}
                    renderSuggestion={(suggestion) => <div>{suggestion}</div>}
                    inputProps={{
                      value: newIngredient,
                      onChange: (e, { newValue }) => setNewIngredient(newValue)
                    }}
                  />
                </div>
                <Button className={styles.addIngredientButton} style="blue" icon="tick" onClick={addIngredient}>Add</Button>
              </div>

            </div>

            <div className={styles.ingredientsGroup}>
              {
                recipe.ingredients.map((ingredient, i) => {
                  return (
                    <div className={styles.ingredientGroup} key={i}>
                      <div className={styles.ingredientName}>
                        <label id={ingredient.name.split(' ').join('=')} htmlFor={`ingredient-name-${i}`} className={i != 0 ? styles.srOnly: ''}>Ingredient </label>
                        {ingredient.name}
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
                        <label className={styles.srOnly}>Delete</label>
                        <button className={styles.trash} aria-label="trash" id={i} onClick={(e) => deleteIngredient(e, ingredient.name)}>×</button>
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
            { error && (
              <Message message={error.message} status='error' />
            )}
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
