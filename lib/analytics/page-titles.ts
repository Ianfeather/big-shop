// The name each route reports to Google, keyed by `router.route` - the *template*,
// never the resolved path.
//
// **This exists so that page titles can never carry content, and it is a rule
// rather than an observation.** Nothing leaks today only because every
// `pageTitle` passed to components/layout happens to be static. That is an
// accident of the current copy, not a property of the code: `pages/recipes/new.tsx`
// already passes `pageTitle` from a variable and reuses it as the visible <h1>,
// so the day someone wants the heading to read "Editing Ragù" the document title
// follows it silently - and `document.title` would carry a Recipe name to a
// fourth party with nothing in this feature having been touched.
//
// A lookup keyed on the route template cannot do that. Adding a route without
// adding a title is a failing test, not a silent fallback to whatever the page
// happened to call itself.
//
// The titles are also deliberately *not* the ones users see. They are labels for
// a report, so "Recipe" reads better than "Recipes" on a detail page, and the
// two Recipes routes are distinguishable where the UI calls both "Recipes".

const PAGE_TITLES: Record<string, string> = {
  '/': 'Home',
  '/account': 'Account',
  '/dave': 'Dave',
  '/list': 'Shopping list',
  '/privacy': 'Privacy policy',
  '/recipes': 'Recipes',
  '/recipes/new': 'Add recipe',
  '/recipes/[id]': 'Recipe',
  '/recipes/[id]/edit': 'Edit recipe',
  '/dev/api-docs': 'Dev: API docs',
  '/dev/design-system': 'Dev: design system',
};

// Next's built-in routes, which have no file under pages/ but can still be the
// value of router.route. Listed rather than allowed through a fallback so that
// the exhaustiveness test below stays meaningful.
const BUILT_IN_TITLES: Record<string, string> = {
  '/_error': 'Error',
  '/404': 'Not found',
  '/500': 'Server error',
};

// The title for a route, or undefined if there isn't one.
//
// **Undefined means "do not report this page", not "fall back to something".**
// A fallback is what would quietly reintroduce the leak: `document.title` on an
// unmapped route is exactly the value this module exists to keep out, and an
// empty string would file real traffic under a blank name. Losing a page view
// for a route somebody forgot to add here is the cheaper mistake, and the test
// makes it a loud one.
export function pageTitleFor(route: string): string | undefined {
  return PAGE_TITLES[route] ?? BUILT_IN_TITLES[route];
}

// Exported for the exhaustiveness test, which reads the pages directory and
// asserts every route has an entry.
export const KNOWN_ROUTES = Object.keys(PAGE_TITLES);
