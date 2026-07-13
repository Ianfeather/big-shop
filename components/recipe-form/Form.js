import styles from './form.module.css';
import { useState, useEffect } from 'react';
import useFetch from 'use-http'
import { useRouter } from 'next/router'
import Button from '@components/button';
import Message from '@components/message';
import Spinner from './spinner';
import mocks from '../../mocks';

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === 'true';

const capitalize = (str) => {
  if (!str) {
    return str;
  }
  const [first, ...rest] = str;
  return [first.toUpperCase(), ...rest].join('');
}

export default function Form({initialRecipe = {}, mode = 'new'}) {
  const bareRecipe = { name: '', remoteUrl: '', notes: '', method: '', ingredients: [], tags: []};

  let useInitialRecipe = Object.keys(initialRecipe).length > 0;
  let [recipe, setRecipe] = useState(useInitialRecipe ? initialRecipe : bareRecipe);
  let [saved, setSaved] = useState(false);
  let [units, setUnits] = useState([]);
  let [tags, setTags] = useState([]);
  let [ingredients, setIngredients] = useState([]);
  let [deleted, setDeleted] = useState(false);
  let [bulkText, setBulkText] = useState('');
  let [bulkError, setBulkError] = useState(null);

  const router = useRouter();
  const { get, post, put, del, response, loading, error } = useFetch(process.env.NEXT_PUBLIC_API_HOST, {
    cachePolicy: 'no-cache'
  });

  const { post: postParseText, response: parseResponse, loading: parseLoading } = useFetch(`${process.env.NEXT_PUBLIC_HOST}/api/parse-recipe-text`, {
    cachePolicy: 'no-cache'
  });

  useEffect(() => {
    if (Object.keys(initialRecipe).length > 0) {
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

  function appendIngredients(parsedIngredients) {
    const newIngredients = parsedIngredients.map(({ name, quantity, unit }) => ({
      name: (name || '').trim(),
      quantity: quantity || '',
      unit: unit || ''
    }));
    setRecipe(prevRecipe => ({
      ...prevRecipe,
      ingredients: [...prevRecipe.ingredients, ...newIngredients]
    }));
  }

  // The extractor can introduce a unit that isn't in the units list fetched at mount (e.g.
  // "bunch") - whether ingredients arrive via appendIngredients or via initialRecipe (URL/camera
  // import). Reconcile reactively rather than inline in each call site, since fetch ordering
  // between the units request and an in-flight extraction isn't guaranteed.
  useEffect(() => {
    const unitNamesInRecipe = [...new Set(recipe.ingredients.map(i => i.unit).filter(Boolean))];
    if (!unitNamesInRecipe.length) return;
    setUnits(prevUnits => {
      const missing = unitNamesInRecipe.filter(
        unit => !prevUnits.some(u => u.name.toLowerCase() === unit.toLowerCase())
      );
      if (!missing.length) return prevUnits;
      return [...prevUnits, ...missing.map(name => ({ id: `new-${name}`, name: capitalize(name) }))];
    });
  }, [recipe.ingredients]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleParseIngredients(e) {
    e.preventDefault();
    if (!bulkText.trim()) return;
    setBulkError(null);
    const result = await postParseText({
      text: bulkText,
      knownIngredients: ingredients,
      knownUnits: units.map(u => u.name)
    });
    if (!parseResponse.ok) {
      setBulkError(result?.error || 'Failed to parse ingredients');
      return;
    }
    appendIngredients(result.ingredients);
    setBulkText('');
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
  }

  if (mode === 'edit' && !recipe.id) {
    return false;
  }

  return (
    <form className={styles.form}>
      <div className={styles.grid}>
        <div className={styles.gridCell}>
          <div className={styles.group}>
            <label htmlFor="recipe-name">Recipe Name <span className={styles.required}>*</span></label>
            <input placeholder="Shepherds Pie" value={recipe.name} autoComplete="off" type="text" id="recipe-name" onChange={(e) => updateRecipe('name', e.target.value)}/>
          </div>
          <div className={styles.group}>
            <label htmlFor="recipe-remote-url">Link to the original recipe</label>
            <input placeholder="https://" value={recipe.remoteUrl} autoComplete="off" type="text" id="recipe-remote-url" onChange={(e) => updateRecipe('remoteUrl', e.target.value)}/>
          </div>
        </div>

        <div className={styles.gridCell}>
          <div className={styles.group}>
            <label htmlFor="recipe-tags">Tags</label>
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
        </div>

        <div className={styles.gridCell}>
          <div className={styles.group}>
            <label htmlFor="add-ingredients">Ingredients</label>
            <div className={styles.addIngredientSection}>
              <div className={styles.addIngredientHint}>Paste or type a full ingredient list, one per line - fractions, dual units (&quot;200g/7oz&quot;) and prep notes are all handled automatically.</div>
              <textarea
                id="add-ingredients"
                className={styles.bulkTextarea}
                rows={6}
                placeholder={'2 tbsp olive oil\n½ tsp ground cinnamon\n1 red chilli, chopped'}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
              />
              <Button
                style="blue"
                icon="tick"
                className={`${parseLoading ? styles.loading : ''}`}
                onClick={handleParseIngredients}
              >
                Parse ingredients
                { parseLoading && <Spinner className={styles.loadingIngredients}>Parsing...</Spinner>}
              </Button>
              { bulkError && (
                <div className={styles.bulkError}>
                  <Message message={bulkError} status='error' />
                </div>
              )}
            </div>

            { recipe.ingredients.length > 0 && (
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
            )}
          </div>
        </div>

        <div className={styles.gridCell}>
          <div className={styles.group}>
            <label htmlFor="recipe-method">Method</label>
            <textarea placeholder="1. Cook until done" value={recipe.method} autoComplete="off" id="recipe-method" rows="5" onChange={(e) => updateRecipe('method', e.target.value)}/>
          </div>
          <div className={styles.group}>
            <label htmlFor="recipe-notes">Notes</label>
            <textarea placeholder="Go heavy on the pepper" value={recipe.notes} autoComplete="off" id="recipe-notes" rows="3" onChange={(e) => updateRecipe('notes', e.target.value)}/>
          </div>
        </div>
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
    </form>
  )
}
