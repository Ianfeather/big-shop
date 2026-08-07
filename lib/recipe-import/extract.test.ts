import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';

vi.mock('../openai-client', () => ({
  openai: { responses: { create: vi.fn() } },
  EXTRACTION_MODEL: 'test-model'
}));

import { openai } from '../openai-client';
import { extractRecipe } from './extract';
import { textToInput } from './paste';
import { htmlToInput } from './url';

const create = (openai as unknown as { responses: { create: Mock } }).responses.create;

function respondWith(payload: Record<string, unknown>) {
  create.mockResolvedValue({
    output_text: JSON.stringify({
      name: '',
      isVegetarian: false,
      method: '',
      newIngredients: [],
      ...payload
    })
  });
}

// The instructions are the prompt string for a text input, and the first
// content part for an image one.
function instructionsSent(): string {
  const { input } = create.mock.calls[0][0];
  return typeof input === 'string' ? input : input[0].content[0].text;
}

beforeEach(() => {
  create.mockReset();
});

// The bug report this file exists for: pasting
//
//   Jerk marinade: 120ml
//   Tomato ketchup: 120ml
//   Pineapple juice or orange juice (or both): 120ml
//   Soy sauce: 80-120ml
//   Brown sugar: 20g
//   Oil: 22.5ml
//
// into the Ingredients box added only lines 2-4 on the first parse, line 1 on a
// second parse of the same text, and lines 5-6 on a third. Nothing between the
// model's reply and the form drops ingredients (the first test below), so the
// omissions are the extraction itself - and the two mechanisms that make a line
// vanish are both in the instructions.
const JERK_PASTE = [
  'Jerk marinade: 120ml',
  'Tomato ketchup: 120ml',
  'Pineapple juice or orange juice (or both): 120ml',
  'Soy sauce: 80-120ml',
  'Brown sugar: 20g',
  'Oil: 22.5ml'
].join('\n');

describe('extractRecipe', () => {
  it('returns every ingredient the model replied with', async () => {
    respondWith({
      ingredients: [
        { name: 'jerk marinade', quantity: '120', unit: 'millilitre' },
        { name: 'tomato ketchup', quantity: '120', unit: 'millilitre' },
        { name: 'pineapple juice', quantity: '120', unit: 'millilitre' },
        { name: 'soy sauce', quantity: '100', unit: 'millilitre' },
        { name: 'brown sugar', quantity: '20', unit: 'gram' },
        { name: 'oil', quantity: '22.5', unit: 'millilitre' }
      ]
    });

    const { ingredients } = await extractRecipe({ input: textToInput(JERK_PASTE) });

    expect(ingredients.map(i => i.name)).toEqual([
      'jerk marinade', 'tomato ketchup', 'pineapple juice', 'soy sauce', 'brown sugar', 'oil'
    ]);
  });

  // The first line went missing on its own, which the pantry-staples rule
  // cannot explain - a marinade is not one of the six staples. What it is, is a
  // plausible recipe title sitting on line 1 of a "Name: amount" list, and the
  // instructions ask for a title. The paste box discards everything except
  // `ingredients`, so a line read as the title is not merely mislabelled, it is
  // gone with nothing shown to the cook.
  it('tells the model a pasted list is all ingredients, so line 1 cannot be taken as the title', async () => {
    respondWith({ ingredients: [] });

    await extractRecipe({ input: textToInput(JERK_PASTE) });

    expect(instructionsSent()).toMatch(/every non-blank line is an ingredient/i);
  });

  // The same instruction must NOT go out for a scraped page, where there really
  // is a title, navigation and a method to tell apart from the ingredients.
  it('leaves a scraped page free to have a title and a method', async () => {
    respondWith({ ingredients: [] });

    await extractRecipe({ input: htmlToInput('<html><title>Jerk chicken</title><body>1 onion</body></html>') });

    expect(instructionsSent()).not.toMatch(/every non-blank line is an ingredient/i);
    expect(instructionsSent()).toMatch(/the recipe's name\/title/);
  });

  // Lines 5 and 6 are brown sugar 20g (~1.5 tbsp) and oil 22.5ml (1.5 tbsp).
  // Both are named pantry staples and both sat just under the "small amount"
  // threshold the extractor used to drop them at - which also explains the third
  // parse finally adding them, since the threshold was fuzzy enough to come out
  // differently run to run.
  //
  // That judgement now lives on the Shopping List, which groups staples away
  // behind a toggle (migration 032). So no Import Source may omit an ingredient
  // any more: the Recipe stays complete, and the shopper can always see what was
  // grouped.
  it.each([
    ['a pasted list', () => textToInput(JERK_PASTE)],
    ['a scraped page', () => htmlToInput('<html><body>1 tbsp olive oil</body></html>')]
  ])('does not ask the model to drop pantry staples from %s', async (_label, makeInput) => {
    respondWith({ ingredients: [] });

    await extractRecipe({ input: makeInput() });

    expect(instructionsSent()).not.toMatch(/Pantry staples:/);
    expect(instructionsSent()).toMatch(/Keep every ingredient:/);
    // Flagged instead of dropped, which is what the Shopping List groups on.
    expect(instructionsSent()).toMatch(/pantryStaple/);
  });

  // The flag has to survive the hop from the model's `newIngredients` metadata
  // onto the ingredient itself, or the save payload never carries it and nothing
  // is ever classified - the same silent-loss shape that cost two Import Sources
  // their Unit Sizes.
  it('carries a pantryStaple proposal onto the ingredient', async () => {
    respondWith({
      ingredients: [
        { name: 'olive oil', quantity: '2', unit: 'tablespoon' },
        { name: 'jerk marinade', quantity: '120', unit: 'millilitre' }
      ],
      newIngredients: [
        { name: 'olive oil', baseUnit: 'millilitre', displayUnit: null, pantryStaple: true, unitSizes: [] },
        { name: 'jerk marinade', baseUnit: 'millilitre', displayUnit: null, pantryStaple: false, unitSizes: [] }
      ]
    });

    const { ingredients } = await extractRecipe({ input: htmlToInput('<html><body>x</body></html>') });

    expect(ingredients[0]).toMatchObject({ name: 'olive oil', pantryStaple: true });
    // false is not carried at all: classification only acts on true, so sending
    // it would put a dead field in every save payload.
    expect(ingredients[1]).not.toHaveProperty('pantryStaple');
  });
});
