import { useQuery } from '@tanstack/react-query';
import useAuth from './use-auth';
import { apiGet } from '../lib/api-client';
import mocks from '../mocks';
import type { Recipe } from '../types/models';

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === 'true';

const bareRecipe: Partial<Recipe> = { tags: [], ingredients: [] };

const useRecipe = (id: string | number | undefined) => {
  const { getAccessTokenSilently } = useAuth();
  // TanStack Query dedupes concurrent calls under the same queryKey, so
  // React 18 Strict Mode's double-invoked effect just reuses the first
  // request instead of racing a second one against it (see CLAUDE.md's
  // "Known rough edge" section, and follow-ups.md #20).
  // Explicit null (not undefined) for "no match" - TanStack Query treats a
  // queryFn resolving to undefined as an error, not a valid "no data" result.
  const { data } = useQuery<Recipe | null>({
    queryKey: ['recipe', id],
    // Before router.isReady, id is undefined (see hooks/use-recipe-id-param.ts)
    // - skip the fetch/mock lookup entirely rather than looking up "undefined".
    enabled: id !== undefined,
    queryFn: async () => {
      if (useMocks) {
        return mocks.recipes.find(r => String(r.id) === String(id) || r.slug === id) ?? null;
      }
      const token = await getAccessTokenSilently();
      return apiGet<Recipe>(`/recipe/${id}`, token);
    }
  });

  // Partial, not Recipe: until the fetch/mock lookup resolves (or if it
  // never matches), all we have is this placeholder shape.
  return [data ?? bareRecipe] as const;
}

export default useRecipe;
