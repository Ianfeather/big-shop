import BBCGoodFood from './bbc-good-food';

// Ideally this becomes a best guess implementation that provides *some* value
// Looong term maybe we can replace all of this with a word2vec style implementation
const defaultScraper = {
  getList(document) {
    return []
  },
  regex: /(?<quantity>\d+)(?: )?(?:(?<unit>[a-zA-Z]{1,4})?) (?<ingredient>[\w| ]+)/
}

// TODO:
// bbc food https://www.bbc.co.uk/food/recipes/chickenandmushroompi_89034
// channel4.com
// great british chefs
// kwestia smaku
// seriouseats
// recipetineats
// simplyrecipes
// allrecipes
// thefoodnetwork
// epicurious
// tasty
// delish
// yummly
// one of the blogging platforms

const hostnameMap = {
  'www.bbcgoodfood.com': BBCGoodFood
}

const getImplementation = (hostname) => {
  return hostnameMap[hostname] || defaultScraper;
}

export default getImplementation;
