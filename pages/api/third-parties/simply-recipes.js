import { clean } from './utils';

const seriousEats = {
  getList(document) {
    const headings = document.querySelectorAll('h1,h2,h3,h4');
    const ingredientHeading = [...headings].filter(heading => (
      heading.innerText.match(/^ingredients$/i)
    ));
    const list = ingredientHeading[0].closest('section').querySelectorAll('li');
    return Array.from(list)
      .map(li => clean(li.innerText))
      // Gotta filter out headings disguised as recipe items
      .filter(li => !li.startsWith('For the '))
  }
};

export default seriousEats;
