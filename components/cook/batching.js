import { extractVerbGroup } from './verbGroups';

// scheduleCookingSession takes an array of recipes (each with a `steps` array)
// and returns an ordered ActionItem[] representing the optimal cooking sequence.
//
// Rules:
// 1. Step order within each recipe is never violated
// 2. When a passive step is reached, schedule it and immediately look for work elsewhere
// 3. Prefer steps sharing a verb group with the most recently completed step (batching heuristic)
// 4. Adjacent same-verb-group steps from different recipes are merged into combined ActionItems
//
// ActionItem shape:
// {
//   type: 'action' | 'passive',
//   steps: [{ recipeId, recipeName, stepId, stepNumber, instruction, durationMinutes, stepType }],
//   mergedLabel: string | null,   // e.g. "also for Curry, Tagine"
//   durationMinutes: number | null,
//   verbGroup: string | null,
// }

const scheduleCookingSession = (recipes) => {
  if (!recipes || recipes.length === 0) return [];

  // Per-recipe pointer tracking which step index is next
  const pointers = recipes.map(() => 0);

  // Track which steps are currently running as passive (don't block their recipe's pointer)
  const runningPassive = new Set();

  const sequence = [];
  let lastVerbGroup = null;

  const getUnblockedSteps = () => {
    const candidates = [];
    for (let ri = 0; ri < recipes.length; ri++) {
      const recipe = recipes[ri];
      if (!recipe.steps || recipe.steps.length === 0) continue;
      const ptr = pointers[ri];
      if (ptr >= recipe.steps.length) continue;

      const step = recipe.steps[ptr];
      candidates.push({ recipeIndex: ri, step });
    }
    return candidates;
  };

  // Main scheduling loop
  let safety = 0;
  while (safety++ < 1000) {
    const candidates = getUnblockedSteps();
    if (candidates.length === 0) break;

    // Separate passive candidates — schedule them all immediately without consuming a turn
    const passiveCandidates = candidates.filter(c => c.step.stepType === 'passive');
    const activeCandidates = candidates.filter(c => c.step.stepType !== 'passive');

    // Schedule all passive steps that are now unblocked
    for (const { recipeIndex, step } of passiveCandidates) {
      const recipe = recipes[recipeIndex];
      sequence.push({
        type: 'passive',
        steps: [{
          recipeId: recipe.id,
          recipeName: recipe.name,
          stepId: step.id,
          stepNumber: step.stepNumber,
          instruction: step.instruction,
          durationMinutes: step.durationMinutes,
          stepType: step.stepType,
        }],
        mergedLabel: null,
        durationMinutes: step.durationMinutes,
        verbGroup: null,
      });
      pointers[recipeIndex]++;
      runningPassive.add(step.id);
    }

    if (activeCandidates.length === 0) break;

    // Pick the best next active step using the batching heuristic:
    // prefer same verb group as last scheduled step
    let chosen = null;
    if (lastVerbGroup) {
      chosen = activeCandidates.find(c => extractVerbGroup(c.step.instruction) === lastVerbGroup) || null;
    }
    if (!chosen) {
      chosen = activeCandidates[0];
    }

    const chosenRecipe = recipes[chosen.recipeIndex];
    const verbGroup = extractVerbGroup(chosen.step.instruction);

    const actionItem = {
      type: 'action',
      steps: [{
        recipeId: chosenRecipe.id,
        recipeName: chosenRecipe.name,
        stepId: chosen.step.id,
        stepNumber: chosen.step.stepNumber,
        instruction: chosen.step.instruction,
        durationMinutes: chosen.step.durationMinutes,
        stepType: chosen.step.stepType,
      }],
      mergedLabel: null,
      durationMinutes: chosen.step.durationMinutes,
      verbGroup,
    };

    pointers[chosen.recipeIndex]++;
    lastVerbGroup = verbGroup;

    sequence.push(actionItem);
  }

  // Merge adjacent same-verb-group action items from different recipes into combined cards
  return mergeAdjacentActions(sequence);
};

// mergeAdjacentActions combines consecutive action items that share a verb group
// and come from different recipes into a single combined ActionItem.
const mergeAdjacentActions = (sequence) => {
  if (sequence.length === 0) return [];

  const merged = [];
  let i = 0;

  while (i < sequence.length) {
    const current = sequence[i];

    // Only merge non-passive action items with a known verb group
    if (
      current.type !== 'action' ||
      !current.verbGroup ||
      current.steps.length === 0
    ) {
      merged.push(current);
      i++;
      continue;
    }

    // Look ahead for consecutive items with the same verb group from different recipes
    const group = [current];
    const seenRecipeIds = new Set(current.steps.map(s => s.recipeId));

    let j = i + 1;
    while (j < sequence.length) {
      const next = sequence[j];
      if (
        next.type !== 'action' ||
        next.verbGroup !== current.verbGroup
      ) break;

      // Only merge if it's a different recipe
      const nextRecipeId = next.steps[0]?.recipeId;
      if (!nextRecipeId || seenRecipeIds.has(nextRecipeId)) break;

      group.push(next);
      seenRecipeIds.add(nextRecipeId);
      j++;
    }

    if (group.length === 1) {
      merged.push(current);
    } else {
      // Build a combined ActionItem
      const allSteps = group.flatMap(item => item.steps);
      const maxDuration = group.reduce((max, item) => {
        if (item.durationMinutes == null) return max;
        return max == null ? item.durationMinutes : Math.max(max, item.durationMinutes);
      }, null);

      const extraRecipeNames = allSteps.slice(1).map(s => s.recipeId);
      const uniqueExtraNames = [...new Set(
        allSteps.slice(1).map(s => s.recipeId)
      )].map(rid => allSteps.find(s => s.recipeId === rid)?.recipeName).filter(Boolean);

      merged.push({
        type: 'action',
        steps: allSteps,
        mergedLabel: uniqueExtraNames.length > 0 ? `also for ${uniqueExtraNames.join(', ')}` : null,
        durationMinutes: maxDuration,
        verbGroup: current.verbGroup,
      });
    }

    i = j;
  }

  return merged;
};

export { scheduleCookingSession, mergeAdjacentActions };
