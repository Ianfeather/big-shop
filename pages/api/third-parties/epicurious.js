import { clean } from './utils';

const epicurious = {
  getList(document) {
    const headings = document.querySelectorAll('h1,h2,h3,h4');
    const ingredientHeading = [...headings].filter(heading => (
      heading.innerText.match(/^ingredients$/ig)
    ));
    // This is where it gets a bit tricky because they don't use lists
    // and they use hashed classnames
    const list = ingredientHeading[0]
      .parentNode
      .querySelector('> div[class^=List]')
      .querySelectorAll('> div');

    return Array.from(list)
      .map(li => clean(li.innerText))
      // Gotta filter out headings disguised as recipe items
      .filter(li => !li.startsWith('For the '))
  }
};

export default epicurious;
