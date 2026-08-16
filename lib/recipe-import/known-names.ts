import { SpanStatusCode } from '@opentelemetry/api';
import { edgeApiHost, serverApiHost } from '../api-host';
import { withTraceHeaders } from '../telemetry/propagate';
import { safeError } from '../telemetry/span';
import { logError } from '../telemetry/log';
import { tracer } from '../telemetry/setup';

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
export async function fetchKnownNames(): Promise<KnownNames> {
  // Netlify's edge in front of the API, falling back to the API directly.
  //
  // Both catalogs answer `public` with an `s-maxage` and are exempt from the
  // API's auth gate, so this crosses the edge and a hit is served from a PoP
  // near this function rather than from Frankfurt - which is the whole of
  // follow-ups.md #51. Locally there is no edge, edgeApiHost returns undefined,
  // and this goes direct exactly as it always did.
  const host = edgeApiHost() ?? serverApiHost();
  if (!host) {
    logError('No API host configured (API_HOST_INTERNAL, or NEXT_PUBLIC_API_HOST locally) - importing without canonical names');
    return EMPTY;
  }

  // One span around both calls, for the same reason lib/telemetry/tool-span.ts
  // wraps each Dave tool call: this is the identical hop - a Netlify function
  // in us-east-2 reaching the Go API - and from the outside an import is a
  // single slow request in which this cost is invisible.
  //
  // It has to be a span here rather than read off the Go API's own server span,
  // which does hang under this trace via the traceparent below. That span
  // measures Go's handling and nothing else; the crossing, the TLS handshake on
  // a cold container, and now the edge lookup all happen outside it, and they
  // are the cost #51 is about. Comparing the two spans' timestamps instead
  // would be measuring clock skew between Netlify and Fly as much as latency.
  //
  // Nothing about the *contents* is recorded - names are catalog data and
  // ADR-0008 §1 keeps content out of telemetry - only how many came back, which
  // is the other half of #51: `GetAllIngredients` is unpaginated and grows
  // monotonically, and this is what makes that growth visible before it matters.
  return tracer().startActiveSpan('bigshop.known_names', async (span) => {
    try {
      const names = await load(host);
      span.setAttribute('bigshop.known_names.ingredients', names.knownIngredients.length);
      span.setAttribute('bigshop.known_names.units', names.knownUnits.length);
      span.setAttribute('bigshop.known_names.via_edge', edgeApiHost() !== undefined);
      return names;
    } catch (e) {
      // Recorded, then swallowed - this function's contract is that it never
      // fails an import. The span is what makes "imports have been losing
      // canonical names for a week" something anyone can find out, which was
      // previously visible only as a log line nobody reads.
      span.recordException(safeError(e));
      span.setStatus({ code: SpanStatusCode.ERROR });
      logError('Could not load canonical Ingredient/Unit names - importing without them', e);
      return EMPTY;
    } finally {
      span.end();
    }
  });
}

async function load(host: string): Promise<KnownNames> {
  const getNames = async (path: string): Promise<string[]> => {
    // No Authorization header, deliberately, and it is load-bearing rather than
    // an omission. These two routes are exempt from the API's auth gate (see
    // GetRouter), and a shared CDN will not reliably store a response to a
    // request carrying Authorization - so sending one would quietly turn the
    // `s-maxage` on both routes into decoration and leave every import paying
    // for the crossing anyway. This used to forward the browser's token; no
    // route here ever validated it, and the Go API no longer asks for one.
    //
    // Propagated for the same reason lib/dave/tools.ts propagates: without it
    // these two calls are traces of their own, and an import's trace has a hole
    // in it where the canonical-name lookup should be.
    const res = await fetch(`${host}${path}`, { headers: withTraceHeaders({}) });
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

  const [knownIngredients, knownUnits] = await Promise.all([
    getNames('/ingredients'),
    getNames('/units'),
  ]);
  return { knownIngredients, knownUnits };
}
