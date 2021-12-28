import BBCGoodFood from './bbc-good-food';

const defaultScraper = {
  getList(document) {
    return []
  },
  regex: /(?<quantity>\d+)(?: )?(?:(?<unit>[a-zA-Z]{1,4})?) (?<ingredient>[\w| ]+)/
}

const hostnameMap = {
  'www.bbcgoodfood.com': BBCGoodFood
}

const getImplementation = (hostname) => {
  return hostnameMap[hostname] || defaultScraper;
}


export default getImplementation;
