import { useQuery } from '@tanstack/react-query';
import useAuth from './use-auth';
import { apiGet } from '../lib/api-client';
import { queryKeys } from '../lib/query-keys';
import type { RecipeSummary } from '../types/models';


const useRecipes = () => {
  const { getAccessTokenSilently } = useAuth();
  // TanStack Query dedupes concurrent calls under the same queryKey, so
  // React 18 Strict Mode's double-invoked effect just reuses the first
  // request instead of racing a second one against it (see CLAUDE.md's
  // "Known rough edge" section, and follow-ups.md #20).
  const { data } = useQuery<RecipeSummary[]>({
    queryKey: queryKeys.recipes,
    queryFn: async () => {
      const token = await getAccessTokenSilently();
      return apiGet<RecipeSummary[]>('/recipes', token);
    }
  });

  return [data ?? []] as const;
};

export default useRecipes;
