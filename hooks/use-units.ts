import { useQuery } from '@tanstack/react-query';
import useAuth from './use-auth';
import { apiGet } from '../lib/api-client';
import { queryKeys } from '../lib/query-keys';
import type { Unit } from '../types/models';


// Shared ['units'] queryKey, read by components/recipe-form/Form. Invalidated
// after a Recipe save, which upserts every Unit its ingredients reference
// (insertUnits in the Go API) and so can introduce one the cached list has
// never seen - "bunch", say, arriving via an import.
const useUnits = () => {
  const { getAccessTokenSilently } = useAuth();
  const { data } = useQuery<Unit[]>({
    queryKey: queryKeys.units,
    queryFn: async () => {
      const token = await getAccessTokenSilently();
      return apiGet<Unit[]>('/units', token);
    }
  });

  return data ?? [];
};

export default useUnits;
