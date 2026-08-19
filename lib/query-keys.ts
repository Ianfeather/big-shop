// Every cached queryKey in the app, in one place.
//
// Keys used to live inline at each useQuery call site, which was fine while
// nothing invalidated them. Now that mutations do (see
// technical-architecture.md's "Cache invalidation"), a key has two authors -
// the hook that reads it and the mutation that invalidates it - and a key
// that drifts between the two doesn't fail loudly, it just silently stops
// invalidating. Hence one definition each.
//
// recipe() coerces its id to a string for exactly that reason. Reads pass the
// router param, which is always a string (hooks/use-recipe-id-param.ts);
// writes pass Recipe.id, which is a number. TanStack Query hashes keys
// structurally, so ['recipe', 5] and ['recipe', '5'] are two unrelated cache
// entries and invalidating one would never touch the other.
export const queryKeys = {
  recipes: ['recipes'] as const,
  recipe: (id: string | number | undefined) =>
    ['recipe', id === undefined ? undefined : String(id)] as const,
  tags: ['tags'] as const,
  units: ['units'] as const,
  invites: ['invites'] as const,
  user: ['user'] as const,
  account: ['account'] as const,
  // Keyed per job and polled until it settles, so it is never shared between
  // call sites and never invalidated. Listed here only to keep this a
  // complete inventory of what is in the cache.
  recipeImageJob: (jobId: string | undefined) => ['recipe-image-job', jobId] as const
} as const;
