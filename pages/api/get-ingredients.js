import { parse } from 'node-html-parser';
import getBackend from './third-parties';

// https://regex101.com/r/of2WLE/2
// Maybe we need to list out all the units in the regex?
// including plurals
const regex = /(?<quantity>[\d|\/]+)(?:\s)?(?:(?<unit>[a-zA-Z\.]{1,5})?) (?<ingredient>[\p{L}\p{M}\-| ]+)/u

const unitMap = {
  g: 'gram',
  kg: 'kilogram',
  tbsp: 'tablespoon',
  ml: 'millilitre',
  l: 'litre',
  tsp: 'teaspoon',
};

function getList(html, backend) {
  const document = parse(html);
  return backend.getList(document)
}

function parseList(list, backend) {
  return list.map(li => {
    const result = li.match(backend.regex || regex);
    let { quantity, unit = '', ingredient } = result?.groups || {};
    unit = unit.toLowerCase().replace('.', '');
    return {
      text: li,
      name: ingredient,
      quantity,
      unit: unitMap[unit] || unit
    }
  })
}

export default async function handler(req, res) {
  const url = req.query.url;
  try {
    const { hostname } = new URL(url);
    const html = await(await fetch(url)).text();
    const backend = getBackend(hostname);
    const list = getList(html, backend);
    const ingredients = parseList(list, backend);
    res.status(200).json(ingredients);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }

}
