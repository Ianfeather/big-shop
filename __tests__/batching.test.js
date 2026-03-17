import { scheduleCookingSession, mergeAdjacentActions } from '../components/cook/batching';
import { extractVerbGroup } from '../components/cook/verbGroups';

// Helpers to build fixture data
const step = (id, number, instruction, stepType, durationMinutes = null) => ({
  id,
  stepNumber: number,
  instruction,
  stepType,
  durationMinutes,
});

const recipe = (id, name, steps) => ({ id, name, steps });

describe('extractVerbGroup', () => {
  test('identifies cut operations', () => {
    expect(extractVerbGroup('Chop the onions finely')).toBe('cut');
    expect(extractVerbGroup('Dice the carrots')).toBe('cut');
    expect(extractVerbGroup('Slice the chicken breast')).toBe('cut');
    expect(extractVerbGroup('Mince the garlic')).toBe('cut');
    expect(extractVerbGroup('Peel and grate the ginger')).toBe('cut');
  });

  test('identifies fry operations', () => {
    expect(extractVerbGroup('Fry the onions until golden')).toBe('fry');
    expect(extractVerbGroup('Sauté the garlic for 2 minutes')).toBe('fry');
    expect(extractVerbGroup('Brown the onions in the pan')).toBe('fry');
  });

  test('identifies bake operations', () => {
    expect(extractVerbGroup('Bake at 180°C for 30 minutes')).toBe('bake');
    expect(extractVerbGroup('Roast the vegetables')).toBe('bake');
    expect(extractVerbGroup('Grill for 10 minutes each side')).toBe('bake');
  });

  test('identifies heat operations', () => {
    expect(extractVerbGroup('Preheat the oven to 200°C')).toBe('heat');
    expect(extractVerbGroup('Bring to the boil')).toBe('heat');
  });

  test('returns null for unclassified instructions', () => {
    expect(extractVerbGroup('Season to taste')).toBeNull();
    expect(extractVerbGroup('Serve immediately')).toBeNull();
    expect(extractVerbGroup('')).toBeNull();
    expect(extractVerbGroup(null)).toBeNull();
  });
});

describe('scheduleCookingSession', () => {
  test('returns empty array for no recipes', () => {
    expect(scheduleCookingSession([])).toEqual([]);
    expect(scheduleCookingSession(null)).toEqual([]);
  });

  test('single recipe passes through in order', () => {
    const recipes = [
      recipe(1, 'Bolognese', [
        step(1, 1, 'Chop the onion', 'prep'),
        step(2, 2, 'Fry the onion', 'cook', 5),
        step(3, 3, 'Simmer for 20 minutes', 'passive', 20),
      ]),
    ];

    const result = scheduleCookingSession(recipes);
    expect(result).toHaveLength(3);
    expect(result[0].steps[0].stepId).toBe(1);
    expect(result[1].steps[0].stepId).toBe(2);
    expect(result[2].steps[0].stepId).toBe(3);
    expect(result[2].type).toBe('passive');
  });

  test('batches matching prep steps from two recipes', () => {
    const recipes = [
      recipe(1, 'Bolognese', [
        step(1, 1, 'Chop the onion', 'prep'),
        step(2, 2, 'Fry the onion', 'cook', 5),
      ]),
      recipe(2, 'Curry', [
        step(3, 1, 'Chop the onion', 'prep'),
        step(4, 2, 'Fry the onion', 'cook', 5),
      ]),
    ];

    const result = scheduleCookingSession(recipes);

    // Both chops should be scheduled before any frying
    const chopIndex = result.findIndex(item =>
      item.steps.some(s => s.stepId === 1)
    );
    const fryIndex = result.findIndex(item =>
      item.steps.some(s => s.stepId === 2)
    );
    expect(chopIndex).toBeLessThan(fryIndex);
  });

  test('does not violate recipe step ordering', () => {
    const recipes = [
      recipe(1, 'Bolognese', [
        step(1, 1, 'Chop onion', 'prep'),
        step(2, 2, 'Fry onion', 'cook', 8),
      ]),
      recipe(2, 'Curry', [
        step(3, 1, 'Chop onion', 'prep'),
        step(4, 2, 'Fry onion', 'cook', 8),
      ]),
    ];

    const result = scheduleCookingSession(recipes);

    // Check recipe 1: step 1 before step 2
    const pos1 = result.findIndex(item => item.steps.some(s => s.stepId === 1));
    const pos2 = result.findIndex(item => item.steps.some(s => s.stepId === 2));
    expect(pos1).toBeLessThan(pos2);

    // Check recipe 2: step 3 before step 4
    const pos3 = result.findIndex(item => item.steps.some(s => s.stepId === 3));
    const pos4 = result.findIndex(item => item.steps.some(s => s.stepId === 4));
    expect(pos3).toBeLessThan(pos4);
  });

  test('passive steps are scheduled and do not block recipe progression', () => {
    const recipes = [
      recipe(1, 'Recipe A', [
        step(1, 1, 'Fry onion', 'cook', 5),
        step(2, 2, 'Simmer for 20 minutes', 'passive', 20),
        step(3, 3, 'Add cream', 'cook', 2),
      ]),
      recipe(2, 'Recipe B', [
        step(4, 1, 'Chop carrot', 'prep'),
      ]),
    ];

    const result = scheduleCookingSession(recipes);

    // All steps should appear
    const allStepIds = result.flatMap(item => item.steps.map(s => s.stepId));
    expect(allStepIds).toContain(1);
    expect(allStepIds).toContain(2);
    expect(allStepIds).toContain(3);
    expect(allStepIds).toContain(4);

    // Passive step should be type 'passive'
    const passiveItem = result.find(item => item.steps.some(s => s.stepId === 2));
    expect(passiveItem.type).toBe('passive');
  });

  test('handles recipes with no steps gracefully', () => {
    const recipes = [
      recipe(1, 'Recipe A', []),
      recipe(2, 'Recipe B', [step(1, 1, 'Chop onion', 'prep')]),
    ];

    const result = scheduleCookingSession(recipes);
    expect(result).toHaveLength(1);
    expect(result[0].steps[0].stepId).toBe(1);
  });

  test('handles steps with null duration', () => {
    const recipes = [
      recipe(1, 'Recipe A', [
        step(1, 1, 'Season to taste', 'other', null),
        step(2, 2, 'Roast for 40 minutes', 'passive', 40),
      ]),
    ];

    const result = scheduleCookingSession(recipes);
    expect(result).toHaveLength(2);
    expect(result[1].type).toBe('passive');
    expect(result[1].durationMinutes).toBe(40);
  });

  test('spec worked example produces correct sequence', () => {
    // Recipe A: cut onion → fry onion → simmer 20m (passive)
    // Recipe B: cut onion → cut carrot → fry carrot → roast 40m (passive)
    const recipes = [
      recipe(1, 'Recipe A', [
        step(1, 1, 'Cut onion', 'prep'),
        step(2, 2, 'Fry onion', 'cook', 8),
        step(3, 3, 'Simmer for 20 minutes', 'passive', 20),
      ]),
      recipe(2, 'Recipe B', [
        step(4, 1, 'Cut onion', 'prep'),
        step(5, 2, 'Cut carrot', 'prep'),
        step(6, 3, 'Fry carrot', 'cook', 6),
        step(7, 4, 'Roast for 40 minutes', 'passive', 40),
      ]),
    ];

    const result = scheduleCookingSession(recipes);

    // All steps scheduled
    const allIds = result.flatMap(item => item.steps.map(s => s.stepId));
    expect(allIds.sort()).toEqual([1, 2, 3, 4, 5, 6, 7].sort());

    // All cut steps before any fry steps (batching)
    const cutPositions = result
      .map((item, i) => ({ i, item }))
      .filter(({ item }) => item.steps.some(s => [1, 4, 5].includes(s.stepId)))
      .map(({ i }) => i);

    const fryPositions = result
      .map((item, i) => ({ i, item }))
      .filter(({ item }) => item.steps.some(s => [2, 6].includes(s.stepId)))
      .map(({ i }) => i);

    expect(Math.max(...cutPositions)).toBeLessThan(Math.min(...fryPositions));
  });
});

describe('mergeAdjacentActions', () => {
  test('merges adjacent same-verb-group steps from different recipes', () => {
    const sequence = [
      {
        type: 'action',
        steps: [{ recipeId: 1, recipeName: 'Bolognese', stepId: 1, instruction: 'Chop onion', stepType: 'prep', durationMinutes: null }],
        verbGroup: 'cut',
        durationMinutes: null,
        mergedLabel: null,
      },
      {
        type: 'action',
        steps: [{ recipeId: 2, recipeName: 'Curry', stepId: 2, instruction: 'Chop onion', stepType: 'prep', durationMinutes: null }],
        verbGroup: 'cut',
        durationMinutes: null,
        mergedLabel: null,
      },
    ];

    const result = mergeAdjacentActions(sequence);
    expect(result).toHaveLength(1);
    expect(result[0].steps).toHaveLength(2);
    expect(result[0].mergedLabel).toBe('also for Curry');
  });

  test('does not merge steps from the same recipe', () => {
    const sequence = [
      {
        type: 'action',
        steps: [{ recipeId: 1, recipeName: 'Bolognese', stepId: 1, instruction: 'Chop onion', stepType: 'prep', durationMinutes: null }],
        verbGroup: 'cut',
        durationMinutes: null,
        mergedLabel: null,
      },
      {
        type: 'action',
        steps: [{ recipeId: 1, recipeName: 'Bolognese', stepId: 2, instruction: 'Chop garlic', stepType: 'prep', durationMinutes: null }],
        verbGroup: 'cut',
        durationMinutes: null,
        mergedLabel: null,
      },
    ];

    const result = mergeAdjacentActions(sequence);
    expect(result).toHaveLength(2);
  });

  test('does not merge across different verb groups', () => {
    const sequence = [
      {
        type: 'action',
        steps: [{ recipeId: 1, recipeName: 'A', stepId: 1, instruction: 'Chop onion', stepType: 'prep', durationMinutes: null }],
        verbGroup: 'cut',
        durationMinutes: null,
        mergedLabel: null,
      },
      {
        type: 'action',
        steps: [{ recipeId: 2, recipeName: 'B', stepId: 2, instruction: 'Fry onion', stepType: 'cook', durationMinutes: 5 }],
        verbGroup: 'fry',
        durationMinutes: 5,
        mergedLabel: null,
      },
    ];

    const result = mergeAdjacentActions(sequence);
    expect(result).toHaveLength(2);
  });

  test('does not merge passive steps', () => {
    const sequence = [
      {
        type: 'passive',
        steps: [{ recipeId: 1, recipeName: 'A', stepId: 1, instruction: 'Simmer 20 minutes', stepType: 'passive', durationMinutes: 20 }],
        verbGroup: null,
        durationMinutes: 20,
        mergedLabel: null,
      },
      {
        type: 'passive',
        steps: [{ recipeId: 2, recipeName: 'B', stepId: 2, instruction: 'Simmer 20 minutes', stepType: 'passive', durationMinutes: 20 }],
        verbGroup: null,
        durationMinutes: 20,
        mergedLabel: null,
      },
    ];

    const result = mergeAdjacentActions(sequence);
    expect(result).toHaveLength(2);
  });

  test('merged duration is the max of merged steps', () => {
    const sequence = [
      {
        type: 'action',
        steps: [{ recipeId: 1, recipeName: 'A', stepId: 1, instruction: 'Chop onion', stepType: 'prep', durationMinutes: 3 }],
        verbGroup: 'cut',
        durationMinutes: 3,
        mergedLabel: null,
      },
      {
        type: 'action',
        steps: [{ recipeId: 2, recipeName: 'B', stepId: 2, instruction: 'Chop carrot', stepType: 'prep', durationMinutes: 7 }],
        verbGroup: 'cut',
        durationMinutes: 7,
        mergedLabel: null,
      },
    ];

    const result = mergeAdjacentActions(sequence);
    expect(result[0].durationMinutes).toBe(7);
  });

  test('passes through steps with no verb group unchanged', () => {
    const sequence = [
      {
        type: 'action',
        steps: [{ recipeId: 1, recipeName: 'A', stepId: 1, instruction: 'Season to taste', stepType: 'other', durationMinutes: null }],
        verbGroup: null,
        durationMinutes: null,
        mergedLabel: null,
      },
    ];

    const result = mergeAdjacentActions(sequence);
    expect(result).toHaveLength(1);
    expect(result[0].steps[0].stepId).toBe(1);
  });
});
