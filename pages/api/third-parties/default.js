import { clean } from './utils';

// This is a best guess implementation that provides *some* value
// Looong term maybe we can replace all of this with a word2vec style implementation
const defaultScraper = {
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
