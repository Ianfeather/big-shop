import { useQuery } from '@tanstack/react-query';
import useAuth from './use-auth';
import { apiGet } from '../lib/api-client';
import mocks from '../mocks';
import type { IngredientName } from '../types/models';

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === 'true';

// Shared ['ingredients'] queryKey - components/recipe-form/Form and
// hooks/use-ingredient-metadata.ts both call this, and TanStack Query
// dedupes/caches across both instead of each firing its own GET /ingredients.
const useIngredientNames = () => {
  const { getAccessTokenSilently } = useAuth();
  const { data } = useQuery<string[]>({
    queryKey: ['ingredients'],
    queryFn: async () => {
      if (useMocks) return mocks.ingredients.map(i => i.name);
      const token = await getAccessTokenSilently();
      const ingredients = await apiGet<IngredientName[]>('/ingredients', token);
      return ingredients.map(i => i.name);
    }
  });

  return data ?? [];
};

export default useIngredientNames;
