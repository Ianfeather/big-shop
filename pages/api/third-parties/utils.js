import {decode} from 'html-entities';

const clean = (str) => {
  // We decode because some sites encode all non-az characters as hex (including spaces)
  return decode(
    // Sometimes we bring in unnecessary line breaks and tabs because we're parsing raw html
    str.replace(/[\n|\r\t]/g, ' ')
    // Remove multiple spaces
    .replace(/ +(?= )/g,'')
    // Some blogs inlcude pointless faux checkboxes
    .replace(/&#x25a2;/g, '')
    // Replace nice but pointless words
    .replace(/\sof\s /, ' ')
    // Replace unit conversions in parentheses (somewhat risky)
    .replace(/\(([^\)]+)\)/g, '')
    .trim()
  );
}

// parseDuration converts an ISO 8601 duration string to minutes (integer).
// Supports PT5M, PT1H, PT1H30M formats. Returns null for invalid/missing input.
const parseDuration = (iso) => {
  if (!iso || typeof iso !== 'string') return null;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return null;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const total = hours * 60 + minutes;
  return total > 0 ? total : null;
};

// inferStepType classifies a cooking instruction string into one of four step types.
const inferStepType = (instruction) => {
  if (!instruction) return 'other';
  const lower = instruction.toLowerCase();

  const passiveKeywords = [
    'bake', 'roast', 'simmer', 'rest', 'marinate', 'chill', 'refrigerate',
    'cool', 'oven', 'grill', 'broil', 'steam', 'poach', 'reduce',
    'leave to', 'set aside', 'allow to', 'let it', 'let the',
  ];
  const prepKeywords = [
    'chop', 'dice', 'slice', 'mince', 'grate', 'peel', 'cut', 'trim',
    'shred', 'julienne', 'measure', 'weigh', 'mix', 'stir', 'whisk',
    'combine', 'fold', 'beat', 'blend', 'toss', 'prepare', 'season',
  ];

  if (passiveKeywords.some(kw => lower.includes(kw))) return 'passive';
  if (prepKeywords.some(kw => lower.includes(kw))) return 'prep';

  const cookKeywords = [
    'fry', 'sauté', 'saute', 'sweat', 'brown', 'sear', 'pan-fry',
    'boil', 'heat', 'cook', 'stir-fry', 'deep-fry',
  ];
  if (cookKeywords.some(kw => lower.includes(kw))) return 'cook';

  return 'other';
};

export {
  clean,
  parseDuration,
  inferStepType,
};
