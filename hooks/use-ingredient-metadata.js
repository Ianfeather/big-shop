import useFetch from 'use-http'
import { useState, useEffect } from 'react';
import mocks from '../mocks';

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === 'true';

// Known ingredient/unit names, used to snap LLM-extracted recipe ingredients
// onto existing canonical names instead of minting near-duplicates.
const useIngredientMetadata = () => {
  let [ingredients, setIngredients] = useState([]);
  let [units, setUnits] = useState([]);
  const { get, response } = useFetch(process.env.NEXT_PUBLIC_API_HOST, {
    cachePolicy: 'no-cache'
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (useMocks) {
        if (!cancelled) {
          setIngredients(mocks.ingredients.map(i => i.name));
          setUnits(mocks.units.map(u => u.name).filter(Boolean));
        }
        return;
      }
      const [_ingredients, _units] = await Promise.all([get('/ingredients'), get('/units')]);
      if (!cancelled && response.ok) {
        setIngredients(_ingredients.map(i => i.name));
        setUnits(_units.map(u => u.name).filter(Boolean));
      }
    }
    load();

    return () => { cancelled = true };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { ingredients, units };
};

export default useIngredientMetadata;
