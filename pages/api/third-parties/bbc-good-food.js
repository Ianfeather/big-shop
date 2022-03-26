import { clean } from './utils';

const BBCGoodFood = {
  getList(document) {
    const headings = document.querySelectorAll('h1,h2,h3,h4');
    const ingredientHeading = [...headings].filter(heading => (
      heading.innerText.match(/ingredients?/ig)
    ));
    const list = ingredientHeading[0].parentNode.querySelectorAll('li');
    return Array.from(list).map(li => clean(li.innerText));
  }
};

export default BBCGoodFood;
