import { useQuery } from '@tanstack/react-query';
import useAuth from './use-auth';
import { apiGet } from '../lib/api-client';


// Shared ['tags'] queryKey - components/recipe-list and components/recipe-form/Form
// both call this, and TanStack Query dedupes/caches across both instead of each
// firing its own GET /tags.
const useTags = () => {
  const { getAccessTokenSilently } = useAuth();
  const { data } = useQuery<string[]>({
    queryKey: ['tags'],
    queryFn: async () => {
      const token = await getAccessTokenSilently();
      return apiGet<string[]>('/tags', token);
    }
  });

  return data ?? [];
};

export default useTags;
