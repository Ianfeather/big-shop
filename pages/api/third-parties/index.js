import defaultScraper from './default';
import BBCGoodFood from './bbc-good-food';
import greatBritishChefs from './great-british-chefs';
import seriousEats from './serious-eats';
import simplyRecipes from './simply-recipes';
import foodNetwork from './food-network';
import epicurious from './epicurious';
import delish from './delish';

const hostnameMap = {
  'www.bbcgoodfood.com': BBCGoodFood,
  'www.greatbritishchefs.com': greatBritishChefs,
  'www.seriouseats.com': seriousEats,
  'www.allrecipes.com': seriousEats,
  'www.simplyrecipes.com': simplyRecipes,
  'foodnetwork.com': foodNetwork, // returns 403
  'foodnetwork.co.uk': foodNetwork, // returns 403
  'www.epicurious.com': epicurious,
  'www.delish.com': delish,
}

const getImplementation = (hostname) => {
  return hostnameMap[hostname] || defaultScraper;
}

export default getImplementation;
