import { useQuery } from '@tanstack/react-query';
import useAuth from './use-auth';
import { apiGet } from '../lib/api-client';
import type { Unit } from '../types/models';


// Shared ['units'] queryKey - components/recipe-form/Form and
// hooks/use-ingredient-metadata.ts both call this, and TanStack Query
// dedupes/caches across both instead of each firing its own GET /units.
const useUnits = () => {
  const { getAccessTokenSilently } = useAuth();
  const { data } = useQuery<Unit[]>({
    queryKey: ['units'],
    queryFn: async () => {
      const token = await getAccessTokenSilently();
      return apiGet<Unit[]>('/units', token);
    }
  });

  return data ?? [];
};

export default useUnits;
