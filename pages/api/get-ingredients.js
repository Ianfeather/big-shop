const jsDom = require('js-dom');

const BBCGoodFood = {
  getElement() {
    const headings = document.querySelectorAll('h1,h2,h3,h4');
  },

  regex: /(?<quantity>\d+)(?: )?(?:(?<unit>[a-zA-Z]{1,4})?) (?<ingredient>.+)/
}

const hostnameMap = {
  'www.bbcgoodfood.com': BBCGoodFood
}

function getList(document, hostname) {
  return hostnameMap[hostname].getElement(document)
}

export default async function handler(req, res) {

  const url = req.params.url;
  const { hostname } = new URL(url);
  const content = fetch(url);
  const document = jsDom.render(content);
  const list = getList(document, hostname);


  const ingredientHeading = [...headings].filter(heading => {
    return heading.innerText.match(/ingredients?/ig)
  });

  if (ingredientHeading.length === 1) {
      const list = ingredientHeading[0].parentNode.querySelector('ul, ol').querySelectorAll('li');
      const ingredients = [...list].map(li => {
        const text = li.innerText.split(',')[0];
        const regex = /(?<quantity>\d+)(?: )?(?:(?<unit>[a-zA-Z]{1,4})?) (?<ingredient>.+)/;
        const result = text.match(regex);
        const { quantity, unit, ingredient } = result?.groups || {};
        return {
          text, quantity, unit, ingredient
        }
      })
      return res.status(200).json(ingredients);
  } else {
    // ??
  }
}
