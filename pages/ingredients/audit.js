import useFetch from 'use-http'
import { useState, useEffect } from 'react';
import Layout, { MainContent } from '@components/layout'
import Button from '@components/button';
import styles from './audit.module.css';

// Not linked from any nav - this is a utility page for correcting the
// preferred_unit/average_weight_grams the LLM classification (or the
// backfill-ingredients command) proposed for each ingredient. Any logged-in
// user can reach it; there's no separate admin role in this app to gate it
// further (see spec/unit-normalisation.md Phase 4).
const IngredientAudit = () => {
  const [ingredients, setIngredients] = useState([]);
  const [units, setUnits] = useState([]);
  const [edits, setEdits] = useState({});
  const [rowStatus, setRowStatus] = useState({});
  const { get, patch, response } = useFetch(process.env.NEXT_PUBLIC_API_HOST, {
    cachePolicy: 'no-cache'
  });

  async function loadData() {
    const [ingredientResult, unitResult] = await Promise.all([
      get('/ingredients'),
      get('/units'),
    ]);
    if (response.ok) {
      setIngredients(ingredientResult || []);
      setUnits(unitResult || []);
    }
  }

  useEffect(() => { loadData() }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function editFor(ingredient) {
    return edits[ingredient.id] || {
      preferredUnitId: ingredient.preferredUnitId ?? '',
      averageWeightGrams: ingredient.averageWeightGrams ?? '',
    };
  }

  function updateEdit(id, field, value) {
    setEdits(prev => ({
      ...prev,
      [id]: { ...editFor({ id, ...ingredients.find(i => i.id === id) }), [field]: value },
    }));
  }

  async function handleSave(ingredient) {
    const edit = editFor(ingredient);
    setRowStatus(prev => ({ ...prev, [ingredient.id]: 'saving' }));

    await patch('/ingredient', {
      id: ingredient.id,
      preferredUnitId: edit.preferredUnitId === '' ? null : Number(edit.preferredUnitId),
      averageWeightGrams: edit.averageWeightGrams === '' ? null : Number(edit.averageWeightGrams),
    });

    if (response.ok) {
      setRowStatus(prev => ({ ...prev, [ingredient.id]: 'saved' }));
      await loadData();
    } else {
      setRowStatus(prev => ({ ...prev, [ingredient.id]: 'error' }));
    }
  }

  return (
    <Layout pageTitle="Ingredient audit">
      <MainContent name="Ingredient audit">
        <h1>Ingredient audit</h1>
        <p>
          Correct the preferred unit and average item weight the LLM proposed (or left blank) for each ingredient.
          These drive how the shopping list combines quantities across recipes.
        </p>
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Ingredient</th>
                <th>Preferred unit</th>
                <th>Average weight (g)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ingredients.map(ingredient => {
                const edit = editFor(ingredient);
                const status = rowStatus[ingredient.id];
                return (
                  <tr key={ingredient.id}>
                    <td>{ingredient.name}</td>
                    <td>
                      <select
                        className={styles.select}
                        value={edit.preferredUnitId}
                        onChange={(e) => updateEdit(ingredient.id, 'preferredUnitId', e.target.value)}
                      >
                        <option value="">Not set</option>
                        {units.filter(u => u.name).map(unit => (
                          <option key={unit.id} value={unit.id}>{unit.name} ({unit.type})</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className={styles.input}
                        type="number"
                        min="0"
                        step="any"
                        placeholder="Not set"
                        value={edit.averageWeightGrams}
                        onChange={(e) => updateEdit(ingredient.id, 'averageWeightGrams', e.target.value)}
                      />
                    </td>
                    <td>
                      <Button style="primary" onClick={() => handleSave(ingredient)}>Save</Button>
                      {status === 'saving' && <span className={styles.status}>Saving…</span>}
                      {status === 'saved' && <span className={styles.status}>Saved</span>}
                      {status === 'error' && <span className={styles.statusError}>Failed to save</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </MainContent>
    </Layout>
  )
}

export default IngredientAudit;
