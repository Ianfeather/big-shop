import useFetch, { CachePolicies } from 'use-http'
import { useState, useEffect } from 'react';
import mocks from '../mocks';
import type { IngredientName, Unit } from '../types/models';

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === 'true';

// Known ingredient/unit names, used to snap LLM-extracted recipe ingredients
// onto existing canonical names instead of minting near-duplicates.
const useIngredientMetadata = () => {
  let [ingredients, setIngredients] = useState<string[]>([]);
  let [units, setUnits] = useState<string[]>([]);
  // use-http's TData is fixed per useFetch() instance, and /ingredients and
  // /units return different shapes, so this needs two instances rather than
  // one shared { get, response } pair.
  const { get: getIngredients, response: ingredientsResponse } = useFetch<IngredientName[]>(process.env.NEXT_PUBLIC_API_HOST, {
    cachePolicy: CachePolicies.NO_CACHE
  });
  const { get: getUnits, response: unitsResponse } = useFetch<Unit[]>(process.env.NEXT_PUBLIC_API_HOST, {
    cachePolicy: CachePolicies.NO_CACHE
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
      const [_ingredients, _units] = await Promise.all([getIngredients('/ingredients'), getUnits('/units')]);
      if (!cancelled && ingredientsResponse.ok && unitsResponse.ok) {
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
