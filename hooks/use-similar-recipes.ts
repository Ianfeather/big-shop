import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import useAuth from './use-auth';
import { apiPost } from '../lib/api-client';
import { queryKeys } from '../lib/query-keys';
import type { SimilarMatch } from '../types/models';

// How long typing has to pause before a search is sent. Exact Matches are
// instant and client-side; this only governs the Jev call behind Similar
// Recipes, where "cur", "curr" and "curry" would otherwise be three paid
// requests for one search (specs/recipe-search-similar-recipes.md, decision 6).
export const SIMILAR_DEBOUNCE_MS = 300;

// Below this, a search is too short to mean anything to judge against.
export const SIMILAR_MIN_QUERY_LENGTH = 3;

const NONE: SimilarMatch[] = [];

// Starts out as UNSET rather than as `value`, so a value is only ever
// "settled" once the delay has elapsed - including the first one. Starting it
// equal to `value` made a hook mounted mid-search send its request at once.
const UNSET = Symbol('unset');

function useDebouncedValue<T>(value: T, delayMs: number): T | typeof UNSET {
  const [debounced, setDebounced] = useState<T | typeof UNSET>(UNSET);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

// The Similar Recipes for a search: those of `candidateIds` that someone
// searching for `query` would want, most probable first.
//
// Always an array, and empty rather than pending or failed - there is no
// loading state and no error state, by design. Similar Recipes are additive:
// they appear under the Exact Matches when they arrive and are simply absent
// otherwise (decision 8). So a failed request is swallowed here, and the
// server already answers a Jev failure with an empty list.
//
// The answer is only ever for the query and candidates currently on screen.
// A new key supersedes the old one, TanStack aborts the superseded request
// through `signal`, and `placeholderData` is deliberately not set - showing
// the previous search's matches under the new search's Exact Matches would be
// showing the wrong answer.
const useSimilarRecipes = (query: string, candidateIds: readonly number[]): SimilarMatch[] => {
  const { getAccessTokenSilently } = useAuth();

  const trimmed = query.trim();
  // Sorted so the same set of Recipes is the same cache entry, whatever order
  // the list happened to be in. A new array every render is fine: TanStack
  // hashes keys by value, and the debounce compares the joined string.
  const sortedIds = [...candidateIds].sort((a, b) => a - b);
  const idsKey = sortedIds.join(',');

  const debouncedQuery = useDebouncedValue(trimmed, SIMILAR_DEBOUNCE_MS);
  const debouncedIdsKey = useDebouncedValue(idsKey, SIMILAR_DEBOUNCE_MS);
  // Only ask once both have settled on what is currently on screen, so a
  // request is never sent for a search the User has already typed past.
  const settled = debouncedQuery === trimmed && debouncedIdsKey === idsKey;

  const enabled = settled && trimmed.length >= SIMILAR_MIN_QUERY_LENGTH && sortedIds.length > 0;

  const { data } = useQuery<SimilarMatch[]>({
    queryKey: queryKeys.similarRecipes(trimmed, sortedIds),
    enabled,
    // A judgment does not go stale on its own; it goes stale when a Recipe
    // changes, and that invalidates it (see queryKeys.similarRecipes).
    staleTime: Infinity,
    retry: false,
    queryFn: async ({ signal }) => {
      const token = await getAccessTokenSilently();
      const body = await apiPost<{ matches: SimilarMatch[] | null }>(
        '/recipes/similar', token, { query: trimmed, candidateIds: sortedIds }, signal
      );
      return body?.matches ?? NONE;
    }
  });

  return (enabled && data) || NONE;
};

export default useSimilarRecipes;
