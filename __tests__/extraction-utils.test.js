import { parseDuration, inferStepType } from '../pages/api/third-parties/utils';

describe('parseDuration', () => {
  test('parses minutes only', () => {
    expect(parseDuration('PT5M')).toBe(5);
    expect(parseDuration('PT30M')).toBe(30);
    expect(parseDuration('PT90M')).toBe(90);
  });

  test('parses hours only', () => {
    expect(parseDuration('PT1H')).toBe(60);
    expect(parseDuration('PT2H')).toBe(120);
  });

  test('parses hours and minutes', () => {
    expect(parseDuration('PT1H30M')).toBe(90);
    expect(parseDuration('PT2H15M')).toBe(135);
  });

  test('returns null for missing or invalid input', () => {
    expect(parseDuration(null)).toBeNull();
    expect(parseDuration(undefined)).toBeNull();
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('not a duration')).toBeNull();
    expect(parseDuration('PT0M')).toBeNull();
  });
});

describe('inferStepType', () => {
  test('classifies passive steps', () => {
    expect(inferStepType('Bake at 180°C for 30 minutes')).toBe('passive');
    expect(inferStepType('Roast the chicken for 1 hour')).toBe('passive');
    expect(inferStepType('Leave to simmer for 20 minutes')).toBe('passive');
    expect(inferStepType('Set aside to rest for 10 minutes')).toBe('passive');
    expect(inferStepType('Chill in the refrigerator for 1 hour')).toBe('passive');
  });

  test('classifies prep steps', () => {
    expect(inferStepType('Chop the onions finely')).toBe('prep');
    expect(inferStepType('Dice the carrots into small cubes')).toBe('prep');
    expect(inferStepType('Whisk together the eggs and milk')).toBe('prep');
    expect(inferStepType('Season with salt and pepper')).toBe('prep');
  });

  test('classifies cook steps', () => {
    expect(inferStepType('Fry the onions until golden')).toBe('cook');
    expect(inferStepType('Heat the oil in a pan')).toBe('cook');
    expect(inferStepType('Cook the pasta until al dente')).toBe('cook');
  });

  test('returns other for unclassified instructions', () => {
    expect(inferStepType('Serve immediately')).toBe('other');
    expect(inferStepType('Enjoy!')).toBe('other');
    expect(inferStepType(null)).toBe('other');
    expect(inferStepType('')).toBe('other');
  });

  test('passive takes priority over prep keywords', () => {
    // "Bake" is passive; even if prep words appear, passive wins
    expect(inferStepType('Bake the chopped mixture')).toBe('passive');
  });
});
