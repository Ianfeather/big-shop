// `source` matters as much as the text here: this is the Ingredients box on the
// recipe form, where the cook has typed or pasted an explicit list of what they
// want. The extractor treats that very differently from a scraped page - see
// buildInstructions in extract.js.
export function textToInput(raw) {
  return { type: 'text', source: 'ingredient-list', text: raw };
}
