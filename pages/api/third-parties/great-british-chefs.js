import { clean } from './utils';

const greatBritishChefs = {
  getList(document) {
    // This site is a little tricky because it has a list for equipment as well
    // which is hard to distinguish.
    // We're just going to trust in an ID and cross fingers here
    const list = document.querySelectorAll('#ingredients-list-container li');
    return Array.from(list).map(li => clean(li.innerText));
  }
};

export default greatBritishChefs;
