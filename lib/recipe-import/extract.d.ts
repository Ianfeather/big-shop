export interface ExtractedIngredient {
  name: string;
  quantity: string;
  unit: string;
}

export interface ExtractInput {
  type: 'text' | 'image';
  text?: string;
  base64?: string;
}

export interface ExtractedRecipe {
  name: string;
  method: string;
  ingredients: ExtractedIngredient[];
  tags: string[];
}

export function extractRecipe(args: {
  input: ExtractInput;
  knownIngredients?: string[];
  knownUnits?: string[];
}): Promise<ExtractedRecipe>;
