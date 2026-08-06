import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { htmlToInput } from './url';

// A verbatim saved copy of a page that used to import as an empty Recipe
// (follow-ups.md #40). It is here at full size on purpose: the bug was that a
// real page's markup is big enough to blow past the truncation limit before the
// ingredients appear, so a trimmed-down fixture would pass against the broken
// code it exists to catch.
const bbcGoodFood = readFileSync(
  join(__dirname, '__fixtures__', 'bbcgoodfood-chicken-tzatziki-wraps.html'),
  'utf8'
);

describe('htmlToInput', () => {
  describe('against a saved real page', () => {
    const { text } = htmlToInput(bbcGoodFood);

    it('includes every ingredient the page lists', () => {
      for (const ingredient of ['cucumber', 'Greek yogurt', 'chicken breast', 'olive oil', 'wholemeal wraps', 'tomatoes']) {
        expect(text).toContain(ingredient);
      }
    });

    it('includes the name and the method', () => {
      expect(text).toContain('Chicken & tzatziki wraps');
      expect(text).toContain('Warm the wraps');
    });

    it('stays comfortably inside the length the extractor is given', () => {
      // The regression itself: the page is over 500KB, and the ingredients used
      // to sit beyond the cut.
      expect(bbcGoodFood.length).toBeGreaterThan(100000);
      expect(text!.length).toBeLessThan(60000);
    });
  });

  it('prefers the JSON-LD recipe over the page text', () => {
    const html = `
      <html><head><script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Recipe',
        name: 'Omelette',
        recipeIngredient: ['3 eggs', '20g butter'],
        recipeInstructions: [
          { '@type': 'HowToStep', text: 'Beat the eggs.' },
          { '@type': 'HowToStep', text: 'Fry them.' }
        ]
      })}</script></head>
      <body><p>Sponsored: buy our pans</p></body></html>`;

    const { text } = htmlToInput(html);

    expect(text).toBe(
      ['Name: Omelette', 'Ingredients:', '- 3 eggs', '- 20g butter', 'Method:', '1. Beat the eggs.', '2. Fry them.'].join('\n')
    );
  });

  it('finds a recipe nested in a @graph, with an array @type', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@graph': [
        { '@type': 'WebPage', name: 'Not the recipe' },
        { '@type': ['Recipe', 'NewsArticle'], name: 'Soup', recipeIngredient: ['1 onion'] }
      ]
    })}</script>`;

    expect(htmlToInput(html).text).toBe(['Name: Soup', 'Ingredients:', '- 1 onion'].join('\n'));
  });

  it('flattens HowToSections and strips markup out of JSON-LD strings', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Recipe',
      name: 'Pie',
      recipeIngredient: ['<span>200g</span> flour'],
      recipeInstructions: [
        { '@type': 'HowToSection', itemListElement: [{ '@type': 'HowToStep', text: 'Make the pastry.' }] },
        { '@type': 'HowToSection', itemListElement: [{ '@type': 'HowToStep', text: '<p>Bake it.</p>' }] }
      ]
    })}</script>`;

    const { text } = htmlToInput(html);

    expect(text).toContain('- 200g flour');
    expect(text).toContain('1. Make the pastry.');
    expect(text).toContain('2. Bake it.');
    expect(text).not.toContain('<span>');
  });

  it('skips a malformed block and keeps reading the rest', () => {
    const html = `
      <script type="application/ld+json">{ not json at all </script>
      <script type="application/ld+json">${JSON.stringify({
        '@type': 'Recipe',
        name: 'Stew',
        recipeIngredient: ['500g beef']
      })}</script>`;

    expect(htmlToInput(html).text).toContain('- 500g beef');
  });

  it('falls back to the page text when there is no JSON-LD recipe', () => {
    const html = `
      <html><head><title>Pancakes</title><script>tracking()</script><style>.a{color:red}</style></head>
      <body><h1>Pancakes</h1><ul><li>2 eggs</li><li>300ml milk</li></ul></body></html>`;

    const { text } = htmlToInput(html);

    expect(text).toContain('Pancakes');
    expect(text).toContain('2 eggs');
    expect(text).toContain('300ml milk');
    expect(text).not.toContain('tracking()');
    expect(text).not.toContain('color:red');
  });

  it('falls back when the JSON-LD recipe carries no ingredients', () => {
    const html = `
      <script type="application/ld+json">${JSON.stringify({ '@type': 'Recipe', name: 'Toast' })}</script>
      <body><ul><li>2 slices of bread</li></ul></body>`;

    expect(htmlToInput(html).text).toContain('2 slices of bread');
  });
});
