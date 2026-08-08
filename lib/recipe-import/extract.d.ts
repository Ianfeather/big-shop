export interface ExtractedIngredient {
  name: string;
  quantity: string;
  unit: string;
  // Catalog metadata proposed for an ingredient this app has not seen before.
  // Declared here so that dropping it somewhere in the chain from extraction to
  // the save payload is a type error rather than a silent loss - which is how
  // two of the three Import Sources managed to lose it.
  baseUnit?: string;
  displayUnit?: string;
  unitSizes?: Record<string, number>;
  pantryStaple?: boolean;
}

export interface ExtractInput {
  type: 'text' | 'image';
  // Which Import Source produced this input. It selects between two materially
  // different prompts - see buildFieldRules in extract.js - so it is required
  // rather than optional: a new Source that forgets it would silently get the
  // scraped-page rules, which is the bug this distinction exists to fix.
  source: 'ingredient-list' | 'page';
  text?: string;
  base64?: string;
}

export interface ExtractedRecipe {
  name: string;
  method: string;
  ingredients: ExtractedIngredient[];
  tags: string[];
}

export interface ExtractedMethod {
  method: string;
}

export function extractRecipe(args: {
  input: ExtractInput;
  knownIngredients?: string[];
  knownUnits?: string[];
}): Promise<ExtractedRecipe>;

// Method Import (see extract.js). No knownIngredients/knownUnits: it returns
// prose, so there is no name or unit for a canonical list to reconcile.
export function extractMethod(args: { input: ExtractInput }): Promise<ExtractedMethod>;
