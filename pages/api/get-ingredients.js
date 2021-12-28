import { parse } from 'node-html-parser';

const defaultScraper = {
  getList(document) {
    return []
  },
  regex: /(?<quantity>\d+)(?: )?(?:(?<unit>[a-zA-Z]{1,4})?) (?<ingredient>[\w| ]+)/
}

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
}

const hostnameMap = {
  'www.bbcgoodfood.com': BBCGoodFood
}

function getList(html, hostname) {
  const document = parse(html);
  return (hostnameMap[hostname] || defaultScraper).getList(document)
}

function parseList(list, hostname) {
  return list.map(li => {
    const result = li.match((hostnameMap[hostname] || defaultScraper).regex);
    const { quantity, unit, ingredient } = result?.groups || {};
    // TODO: handle missing ones? Tidy up the response
    return {
      text: li, quantity, unit, ingredient
    }
  })
}

export default async function handler(req, res) {
  const url = req.query.url;
  try {
    const { hostname } = new URL(url);
    const html = await(await fetch(url)).text();
    const list = getList(html, hostname);
    const ingredients = parseList(list, hostname);
    res.status(200).json(ingredients);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to load data' });
  }

}
