import { useQuery } from '@tanstack/react-query';
import useAuth from './use-auth';
import { apiGet } from '../lib/api-client';
import { queryKeys } from '../lib/query-keys';
import type { User } from '../types/models';

// The signed-in User, for the view preferences they carry.
//
// GET /user 404s for someone who reached an inner page before POST /user ever
// ran for them, which is a real state rather than a fault - so this never
// retries and callers treat `undefined` as "nothing recorded yet" and fall back
// to whatever they were already showing.
const useUser = () => {
  const { getAccessTokenSilently, isAuthenticated } = useAuth();

  const { data } = useQuery<User>({
    queryKey: queryKeys.user,
    enabled: isAuthenticated,
    retry: false,
    queryFn: async () => {
      const token = await getAccessTokenSilently();
      return apiGet<User>('/user', token);
    }
  });

  return data;
};

export default useUser;
