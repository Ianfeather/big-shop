import { clean, parseDuration, inferStepType } from './utils';

// This is a best guess implementation that provides *some* value
// Looong term maybe we can replace all of this with a word2vec style implementation
const defaultScraper = {
  // getSteps attempts to extract structured cooking steps from a page.
  // Primary path: schema.org/Recipe JSON-LD (recipeInstructions).
  // Returns an array of { instruction, durationMinutes, stepType } or null if nothing found.
  getSteps(document) {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      let data;
      try {
        data = JSON.parse(script.innerText || script.textContent);
      } catch {
        continue;
      }

      // JSON-LD can be a single object or an array
      const nodes = Array.isArray(data) ? data : [data];
      const recipeNode = nodes.find(n => n && (n['@type'] === 'Recipe' || (Array.isArray(n['@type']) && n['@type'].includes('Recipe'))));
      if (!recipeNode?.recipeInstructions) continue;

      const instructions = recipeNode.recipeInstructions;

      // recipeInstructions can be an array of strings or HowToStep objects
      const steps = instructions
        .map((item, i) => {
          const text = typeof item === 'string' ? item : (item.text || item.name || '');
          if (!text.trim()) return null;
          const duration = parseDuration(item.performTime || item.totalTime || null);
          return {
            instruction: text.trim(),
            durationMinutes: duration,
            stepType: inferStepType(text),
          };
        })
        .filter(Boolean);

      if (steps.length > 0) return steps;
    }
    return null;
  },

  getList(document) {
    const headings = document.querySelectorAll('h1,h2,h3,h4');
    const ingredientHeadings = [...headings]
      // Get all headings that contain the word `ingredients`
      .filter(heading => (
        heading.innerText.match(/ingredients?/ig)
      ))
      // Filter out headings that aren't in a section with list items
      .filter(heading => heading.parentNode.querySelectorAll('li').length > 0);

    // If we just have one then we're hopefully good to go
    if (ingredientHeadings.length === 1) {
      const list = ingredientHeadings[0].parentNode.querySelectorAll('li');
      return Array.from(list).map(li => clean(li.innerText));
    }
    // If we have more than one, let's see if we have any which just contain the word `Ingredients`
    const strictHeadings = ingredientHeadings.filter(h => h.innerText.match(/^ingredients$/i));
    if (strictHeadings.length === 1) {
      const list = strictHeadings[0].parentNode.querySelectorAll('li');
      return Array.from(list).map(li => clean(li.innerText));
    }

    // If that doesn't work, let's take the last heading as that seems to be common on blog sites
    const list = ingredientHeadings[ingredientHeadings.length - 1].parentNode.querySelectorAll('li');
    return Array.from(list).map(li => clean(li.innerText));
  }
}

export default defaultScraper;
