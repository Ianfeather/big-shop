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
  const { data, isSuccess } = useQuery<RecipeSummary[]>({
    queryKey: queryKeys.recipes,
    queryFn: async () => {
      const token = await getAccessTokenSilently();
      return apiGet<RecipeSummary[]>('/recipes', token);
    }
  });

  // The second element says whether the query has *resolved*, and it exists
  // because the first element cannot say so.
  //
  // `data ?? []` is what keeps every consumer able to `.map()` immediately (see
  // the test below), and the price of that default is that an empty list in
  // flight is indistinguishable from an empty list that came back. For the
  // existing call sites that costs nothing - rendering no recipe rows for a
  // moment is exactly right. For anything that wants to *say something about*
  // an account having no recipes it is the whole question, and answering it
  // from `recipes.length === 0` alone puts the message on screen for a moment
  // on every load, for everybody, including someone with two hundred recipes.
  //
  // This codebase has been here before and left the lesson in pages/account.tsx:
  // the emailed-invite message is gated on the invites query having resolved,
  // and `otherMembers` is deliberately not defaulted, because a default reads
  // as a real answer while the request is still in flight. Same trap, same fix.
  //
  // Additive on purpose: every existing `const [recipes] = useRecipes()` call
  // site ignores this harmlessly.
  return [data ?? [], isSuccess] as const;
};

export default useRecipes;
