import { clean } from './utils';

const delish = {
  getList(document) {
    // Very non-ideal, but no headings and no lists
    const list = document.querySelectorAll('.ingredient-item');
    return Array.from(list).map(li => clean(li.innerText));
  }
};

export default delish;
