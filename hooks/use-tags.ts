import { useQuery } from '@tanstack/react-query';
import useAuth from './use-auth';
import { apiGet } from '../lib/api-client';
import { queryKeys } from '../lib/query-keys';


// Shared ['tags'] queryKey - components/recipe-list and components/recipe-form/Form
// both call this, and TanStack Query dedupes/caches across both instead of each
// firing its own GET /tags.
//
// Nothing invalidates this: /tags reads the `tag` table, which is a fixed
// list the app never writes to. Saving a Recipe only writes the `recipe_tag`
// join rows (insertTags in the Go API), so the set of available tags cannot
// go stale.
const useTags = () => {
  const { getAccessTokenSilently } = useAuth();
  const { data } = useQuery<string[]>({
    queryKey: queryKeys.tags,
    queryFn: async () => {
      const token = await getAccessTokenSilently();
      return apiGet<string[]>('/tags', token);
    }
  });

  return data ?? [];
};

export default useTags;
