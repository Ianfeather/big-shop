import styles from './form.module.css';
import { MouseEvent, useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/router'
import Button from '@components/button';
import Message from '@components/message';
import Spinner from './spinner';
import useUnits from '@hooks/use-units';
import useTags from '@hooks/use-tags';
import useAuth from '@hooks/use-auth';
import { apiPost, apiPut, apiDelete, nextApiPost } from '../../lib/api-client';
import { queryKeys } from '../../lib/query-keys';
import type { Recipe as RecipeModel, Ingredient, CreatedResponse } from '../../types/models';

const capitalize = (str: string) => {
  if (!str) {
    return str;
  }
  const [first, ...rest] = str;
  return [first.toUpperCase(), ...rest].join('');
}

interface FormRecipe {
  id?: number;
  name: string;
  remoteUrl: string;
  notes: string;
  method: string;
  ingredients: Ingredient[];
  tags: string[];
}

// units carries both real, fetched Units (numeric id) and ones synthesized
// locally for an extracted unit the /units list doesn't know about yet
// (string id, see the reconciliation effect below).
interface FormUnit {
  id: number | string;
  name: string;
}

interface FormProps {
  initialRecipe?: Partial<RecipeModel>;
  mode?: 'new' | 'edit';
}

interface ParseTextResult {
  ingredients?: Partial<Ingredient>[];
  error?: string;
}

// initialRecipe's tags/ingredients can be null (see Recipe's OpenAPI schema)
// - bareRecipe's [] is the fallback, same as every other field's fallback.
function normalizeInitialRecipe(initialRecipe: Partial<RecipeModel>, bareRecipe: FormRecipe): FormRecipe {
  return {
    ...bareRecipe,
    ...initialRecipe,
    ingredients: (initialRecipe.ingredients ?? bareRecipe.ingredients) as Ingredient[],
    tags: (initialRecipe.tags ?? bareRecipe.tags) as string[],
  };
}

export default function Form({initialRecipe = {}, mode = 'new'}: FormProps) {
  const bareRecipe: FormRecipe = { name: '', remoteUrl: '', notes: '', method: '', ingredients: [], tags: []};

  let useInitialRecipe = Object.keys(initialRecipe).length > 0;
  let [recipe, setRecipe] = useState<FormRecipe>(useInitialRecipe ? normalizeInitialRecipe(initialRecipe, bareRecipe) : bareRecipe);
  // units stays local state (not read directly off useUnits()) because the
  // reconciliation effect below appends synthetic entries for units the
  // extractor introduces that aren't in the fetched list yet (e.g. "bunch").
  let [units, setUnits] = useState<FormUnit[]>([]);
  const fetchedUnits = useUnits();
  const tags = useTags();
  let [deleted, setDeleted] = useState(false);
  let [bulkText, setBulkText] = useState('');
  let [bulkError, setBulkError] = useState<string | null>(null);

  const router = useRouter();
  const { getAccessTokenSilently } = useAuth();
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: async (recipeToSave: FormRecipe): Promise<CreatedResponse | undefined> => {
      const token = await getAccessTokenSilently();
      if (mode === 'edit') {
        await apiPut('/recipe', token, recipeToSave);
        return undefined;
      }
      // POST /recipe returns the new recipe's id (CreatedResponse) so we can
      // redirect straight to its detail page without a follow-up GET.
      return apiPost<CreatedResponse>('/recipe', token, recipeToSave);
    },
    onSuccess: (result) => {
      // The Recipe summary list carries name and tags, both editable here, and
      // gains a whole entry on create. The redirect below happens to remount a
      // consumer either way, but relying on that is what follow-ups.md #30 was
      // about: staleTime is 0, so the remount serves the stale list first and
      // only then refetches - the just-saved Recipe is briefly missing or
      // out of date. Invalidating makes the refetch the point rather than a
      // side effect of navigating.
      queryClient.invalidateQueries({ queryKey: queryKeys.recipes });
      // A save upserts every Unit its ingredients reference (insertUnits in
      // the Go API), so a Recipe that introduced "bunch" has just created a
      // Unit the cached /units list doesn't have. Exactly the shape of the
      // ['ingredients'] staleness that prompted #30.
      queryClient.invalidateQueries({ queryKey: queryKeys.units });
      // ['tags'] deliberately not invalidated: the `tag` table is a fixed list
      // the app never inserts into (see hooks/use-tags.ts).
      if (mode === 'edit') {
        queryClient.invalidateQueries({ queryKey: queryKeys.recipe(recipe.id) });
        router.push(`/recipes/${recipe.id}?stored=updated`);
      } else {
        // Nothing has cached the new Recipe yet - there is no entry to invalidate.
        router.push(`/recipes/${result?.id}?stored=new`);
      }
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const token = await getAccessTokenSilently();
      return apiDelete('/recipe', token, { id: recipe.id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.recipes });
      // Remove rather than invalidate: the Recipe is gone, so a refetch would
      // just 404. Removing is safe with this page's useRecipe still mounted -
      // an observer whose query is removed keeps rendering its last value
      // instead of refetching - and we navigate away immediately anyway. The
      // point is that a later visit to this URL starts from nothing rather
      // than rendering a deleted Recipe from cache.
      queryClient.removeQueries({ queryKey: queryKeys.recipe(recipe.id) });
      setDeleted(true);
      router.push('/recipes');
    }
  });

  // The route reads the canonical Ingredient/Unit names from the database
  // itself; the token is forwarded purely so it can make that call. Extraction
  // only - it writes nothing, so there is nothing to invalidate. The new
  // Ingredients and Units land when the Recipe itself is saved, above.
  const parseTextMutation = useMutation({
    mutationFn: async (payload: { text: string }) => {
      const token = await getAccessTokenSilently();
      return nextApiPost<ParseTextResult>(`${process.env.NEXT_PUBLIC_HOST}/api/parse-recipe-text`, payload, token);
    }
  });

  const loading = saveMutation.isPending;
  const error = saveMutation.error || deleteMutation.error;

  useEffect(() => {
    if (Object.keys(initialRecipe).length > 0) {
      setRecipe(normalizeInitialRecipe(initialRecipe, bareRecipe));
    }
  }, [initialRecipe]); // eslint-disable-line react-hooks/exhaustive-deps

  // Seeds units from the fetched list once it arrives; the reconciliation
  // effect below is what appends synthetic entries on top of it.
  useEffect(() => {
    if (fetchedUnits.length) {
      setUnits(fetchedUnits.map(unit => ({...unit, name: capitalize(unit.name)})));
    }
  }, [fetchedUnits]); // eslint-disable-line react-hooks/exhaustive-deps

  function updateRecipe<K extends keyof FormRecipe>(key: K, value: FormRecipe[K]) {
    const updatedRecipe = { ...recipe, [key]: value};
    setRecipe(updatedRecipe)
  }

  function updateRecipeTags(value: string) {
    const exists = recipe.tags.includes(value);
    let newTags: string[];
    if (exists) {
      newTags = recipe.tags.filter(tag => tag != value)
    } else {
      // tags.find always succeeds here: value only ever comes from a
      // checkbox whose value={tag} was itself sourced from this same tags
      // array (see the render below).
      newTags = [...recipe.tags, tags.find(t => t === value)!]
    }
    const updatedRecipe = { ...recipe, tags: newTags};
    setRecipe(updatedRecipe)
  }

  // baseUnit/displayUnit/unitSizes are catalog metadata the extractor proposes
  // for ingredients this app has never seen (see CONTEXT.md's Unit Size). They
  // are carried straight through to the save payload rather than shown in the
  // form: there is nothing useful for a cook to do with "one onion is 150g"
  // while writing a recipe, and the server ignores them for any ingredient that
  // already has values.
  function appendIngredients(parsedIngredients: Partial<Ingredient>[]) {
    const newIngredients = parsedIngredients.map(({ name, quantity, unit, baseUnit, displayUnit, unitSizes }) => ({
      name: (name || '').trim(),
      quantity: quantity || '',
      unit: unit || '',
      ...(baseUnit ? { baseUnit } : {}),
      ...(displayUnit !== undefined && displayUnit !== null ? { displayUnit } : {}),
      ...(unitSizes ? { unitSizes } : {}),
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

  async function handleParseIngredients(e: { preventDefault: () => void }) {
    e.preventDefault();
    if (!bulkText.trim()) return;
    setBulkError(null);
    try {
      const result = await parseTextMutation.mutateAsync({
        text: bulkText,
      });
      appendIngredients(result?.ingredients || []);
      setBulkText('');
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'Failed to parse ingredients');
    }
  }

  function updateIngredient(i: number, key: 'quantity' | 'unit', value: string) {
    let newIngredients = [...recipe.ingredients];
    newIngredients[i][key] = value;
    setRecipe({
      ...recipe,
      ingredients: newIngredients
    });
  }

  function submitRecipe(e: MouseEvent) {
    e.preventDefault();
    saveMutation.mutate(recipe);
  }

  function deleteRecipe(e: MouseEvent) {
    e.preventDefault();
    deleteMutation.mutate();
  }

  function deleteIngredient(e: MouseEvent, name: string) {
    e.preventDefault();
    setRecipe({
      ...recipe,
      ingredients: recipe.ingredients.filter(ingredient => ingredient.name !== name)
    })
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
                style="primary"
                icon="tick"
                className={`${parseTextMutation.isPending ? styles.loading : ''}`}
                onClick={handleParseIngredients}
              >
                Parse ingredients
                { parseTextMutation.isPending && <Spinner className={styles.loadingIngredients}>Parsing...</Spinner>}
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
                                <option key={id} id={String(id)} value={name.toLowerCase()}>{name}</option>
                              ))
                            }
                          </select>
                        </div>

                        <div className={styles.deleteColumn}>
                          <label className={styles.srOnly}>Delete</label>
                          <button className={styles.trash} aria-label="trash" id={String(i)} onClick={(e) => deleteIngredient(e, ingredient.name)}>×</button>
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
            <textarea placeholder="1. Cook until done" value={recipe.method} autoComplete="off" id="recipe-method" rows={5} onChange={(e) => updateRecipe('method', e.target.value)}/>
          </div>
          <div className={styles.group}>
            <label htmlFor="recipe-notes">Notes</label>
            <textarea placeholder="Go heavy on the pepper" value={recipe.notes} autoComplete="off" id="recipe-notes" rows={3} onChange={(e) => updateRecipe('notes', e.target.value)}/>
          </div>
        </div>
      </div>

      <div className={styles.buttonContainer}>
        <Button style="primary" icon="tick" disabled={loading} onClick={submitRecipe}>
          { mode === 'edit' ? 'Update Recipe' : 'Save Recipe'}
          { loading && <Spinner className={styles.loadingIngredients}>Saving...</Spinner>}
        </Button>
        {
          mode === 'edit' && (
            <div>
              <Button style="danger" icon="trash" onClick={deleteRecipe}>Delete Recipe</Button>
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
