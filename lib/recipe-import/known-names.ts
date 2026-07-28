import type { NextApiRequest } from 'next';

export type KnownNames = { knownIngredients: string[]; knownUnits: string[] };

const EMPTY: KnownNames = { knownIngredients: [], knownUnits: [] };

// The canonical Ingredient and Unit names that lib/recipe-import/extract.js
// tells the model to reuse rather than coin a near-duplicate of, and that
// matchCanonicalIngredient snaps parsed names onto as a deterministic fallback.
//
// Read here, server-side, at the moment of the request. The client used to send
// both lists up with every parse, sourced from TanStack Query caches that
// nothing in this codebase ever invalidates - so saving a Recipe that created
// new Ingredients left the next import's prompt unaware of them, and the model
// would happily mint a second name for something created moments earlier. That
// is exactly the catalog fragmentation migration 029 exists to undo, so the
// list is now taken from the database on every call and the client is not asked
// for it at all.
//
// Never throws, and never rejects. Losing canonicalisation costs a bonus;
// losing the import costs the user their recipe. `extract.js` degrades
// honestly on an empty list - buildInstructions simply omits the reuse
// instruction rather than referring to a list that isn't there.
export async function fetchKnownNames(req: NextApiRequest): Promise<KnownNames> {
  const host = process.env.NEXT_PUBLIC_API_HOST;
  if (!host) {
    console.error('NEXT_PUBLIC_API_HOST is not set - importing without canonical names');
    return EMPTY;
  }

  // Forwarded straight through from the browser. These routes do not validate
  // it themselves; the Go API is the thing that decides whether it is good.
  const authorization = req.headers.authorization;
  const headers = authorization ? { Authorization: authorization } : undefined;

  const getNames = async (path: string): Promise<string[]> => {
    const res = await fetch(`${host}${path}`, { headers });
    if (!res.ok) {
      throw new Error(`GET ${path} failed with status ${res.status}`);
    }
    const rows = (await res.json()) as { name: string }[];
    // filter(Boolean) drops the blank-named count Unit, which is a real row but
    // meaningless in a prompt that asks the model to pick a unit word. The two
    // call sites this replaces disagreed about that: the paste box sent it and
    // the URL/photo paths did not.
    return rows.map((row) => row.name).filter(Boolean);
  };

  try {
    const [knownIngredients, knownUnits] = await Promise.all([
      getNames('/ingredients'),
      getNames('/units'),
    ]);
    return { knownIngredients, knownUnits };
  } catch (e) {
    console.error('Could not load canonical Ingredient/Unit names - importing without them', e);
    return EMPTY;
  }
}
