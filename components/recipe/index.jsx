import TagPill from '@components/tag-pill';
import styles from './index.module.css';

const RecipeLink = ({ link }) => {
  if (!link) return false;
  if (link.match(/^http/)) {
    return <a target="_blank" rel="noreferrer" href={link}>View original recipe</a>;
  }
  return <span>Taken from {link}</span>;
}

// Best-effort client-side split of "1. Do this 2. Do that" style method text
// into discrete steps. Only treats it as a numbered list when the markers
// form a genuine 1, 2, 3... sequence, so an oven temperature like "200." mid
// sentence can't be mistaken for a list marker. The real fix - storing steps
// as structured data instead of parsing prose - is backlogged.
function parseMethodSteps(method) {
  if (!method) return null;

  const matches = [...method.matchAll(/(?:^|\s)(\d+)\.\s+/g)];
  const numbers = matches.map(m => Number(m[1]));
  const looksNumbered = numbers.length >= 2 && numbers.every((n, i) => n === i + 1);
  if (!looksNumbered) return null;

  return method.split(/(?:^|\s)\d+\.\s+/).map(step => step.trim()).filter(Boolean);
}

const Method = ({ method }) => {
  const steps = parseMethodSteps(method);

  if (!steps) {
    return <p>{method}</p>;
  }

  return (
    <ol className={styles.steps}>
      {steps.map((step, i) => (
        <li className={styles.step} key={i}>
          <span className={styles.stepNumber}>{i + 1}</span>
          <span>{step}</span>
        </li>
      ))}
    </ol>
  );
}

const Recipe = ({ recipe }) => {
  return (
    <>
      <RecipeLink link={recipe.remoteUrl} />
      <p>{recipe.notes}</p>
      <div className={styles.container}>
        {
          recipe.tags.map(tag => (
            <TagPill key={tag} tag={tag} />
          ))
        }
      </div>
      <div className={styles.ingredients}>
        <h3 className={styles.heading}>Ingredients</h3>
        <ul>
          {(recipe.ingredients || []).map(ingredient => (
            <li className={styles.ingredient} key={ingredient.name}>
              <span className={styles.amount}>{ingredient.quantity} {ingredient.unit}</span>
              <span className={styles.ingredientName}>{ingredient.name}</span>
            </li>
          ))}
        </ul>
      </div>
      <h3 className={styles.heading}>Method</h3>
      <Method method={recipe.method} />
    </>
  )
}

export default Recipe;
