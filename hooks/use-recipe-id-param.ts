import { useRouter } from 'next/router';

// Before router.isReady, router.query is always {} regardless of the actual
// URL, so reading `id` off it early is a lie, not just an unpopulated value.
// Returning undefined until isReady lets callers (and useRecipe) tell "not
// resolved yet" apart from "resolved to this id", instead of asserting a
// value that isn't there yet.
const useRecipeIdParam = (): string | undefined => {
  const router = useRouter();
  if (!router.isReady) return undefined;
  // Never a catch-all route, so router.query.id is only ever a single string.
  return router.query.id as string;
};

export default useRecipeIdParam;
