import useUnits from './use-units';
import useIngredientNames from './use-ingredient-names';

// Known ingredient/unit names, used to snap LLM-extracted recipe ingredients
// onto existing canonical names instead of minting near-duplicates.
const useIngredientMetadata = () => {
  const units = useUnits();
  const ingredients = useIngredientNames();

  return {
    ingredients,
    units: units.map(u => u.name).filter(Boolean)
  };
};

export default useIngredientMetadata;
