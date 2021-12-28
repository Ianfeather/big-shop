const BBCGoodFood = {
  getList(document) {
    const headings = document.querySelectorAll('h1,h2,h3,h4');
    const ingredientHeading = [...headings].filter(heading => (
      heading.innerText.match(/ingredients?/ig)
    ));
    const list = ingredientHeading[0].parentNode.querySelector('ul, ol').querySelectorAll('li');
    return Array.from(list).map(li => li.innerText);
  },

  regex: /(?<quantity>\d+)(?: )?(?:(?<unit>[a-zA-Z]{1,4})?) (?<ingredient>[\w| ]+)/
};

export default BBCGoodFood;