const VERB_GROUPS = {
  cut: ['chop', 'dice', 'slice', 'mince', 'grate', 'cut', 'julienne', 'peel', 'trim', 'shred'],
  measure: ['measure', 'weigh', 'portion'],
  mix: ['mix', 'stir', 'whisk', 'combine', 'fold', 'beat', 'blend', 'toss'],
  heat: ['preheat', 'boil', 'bring to', 'heat oil', 'heat the'],
  fry: ['fry', 'sauté', 'saute', 'sweat', 'brown', 'sear', 'pan-fry'],
  bake: ['bake', 'roast', 'grill', 'broil', 'toast'],
  simmer: ['simmer', 'reduce', 'cook on low', 'cook over low'],
};

// Returns the verb group key for a given instruction string, or null
const extractVerbGroup = (instruction) => {
  if (!instruction) return null;
  const lower = instruction.toLowerCase();
  for (const [group, keywords] of Object.entries(VERB_GROUPS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      return group;
    }
  }
  return null;
};

export { VERB_GROUPS, extractVerbGroup };
