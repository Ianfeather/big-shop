import { ReactNode } from 'react';
import Link from 'next/link';
import TagPill from '@components/tag-pill';
import icons from '@components/svg';
import styles from './index.module.css';

const PencilIcon = icons.pencil;
import type { Recipe as RecipeModel } from '../../types/models';

const RecipeLink = ({ link }: { link?: string | null }) => {
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
function parseMethodSteps(method?: string | null) {
  if (!method) return null;

  const matches = [...method.matchAll(/(?:^|\s)(\d+)\.\s+/g)];
  const numbers = matches.map(m => Number(m[1]));
  const looksNumbered = numbers.length >= 2 && numbers.every((n, i) => n === i + 1);
  if (!looksNumbered) return null;

  return method.split(/(?:^|\s)\d+\.\s+/).map(step => step.trim()).filter(Boolean);
}

const Method = ({ method }: { method?: string | null }) => {
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

// A recipe imported from a photo or a URL often arrives with one half missing -
// ingredients but no method, most commonly. The empty section still renders,
// deliberately: it's the only thing that tells you the method is missing rather
// than merely not shown. The pencil beside it turns that dead end into the way
// to fill it, and appears only while the section is empty so a complete recipe
// isn't littered with edit affordances (the masthead's Edit covers that).
const SectionHeading = ({ children, addLabel, editHref }: { children: ReactNode; addLabel: string; editHref?: string }) => (
  <div className={styles.sectionHeading}>
    <h3 className={styles.heading}>{children}</h3>
    {/* A bare pencil rather than a Button: it's a quiet hint that the section
        can be filled in, not the page's action. */}
    { editHref && (
      <Link href={editHref} className={styles.addLink} aria-label={addLabel} title={addLabel}>
        <PencilIcon className={styles.addIcon} />
      </Link>
    )}
  </div>
);

const Recipe = ({ recipe }: { recipe: Partial<RecipeModel> }) => {
  const ingredients = recipe.ingredients || [];
  // Whitespace-only method text counts as missing: it renders as an empty
  // section either way, so it should offer the same way out.
  const hasMethod = !!recipe.method?.trim();
  const editHref = recipe.id ? `/recipes/${recipe.id}/edit` : undefined;

  return (
    <>
      <RecipeLink link={recipe.remoteUrl} />
      <p>{recipe.notes}</p>
      <div className={styles.container}>
        {
          // Recipe.tags can be null (nullable in the OpenAPI schema).
          (recipe.tags || []).map(tag => (
            <TagPill key={tag} tag={tag} />
          ))
        }
      </div>
      <div className={styles.section}>
        <SectionHeading addLabel="Add ingredients" editHref={ingredients.length ? undefined : editHref}>
          Ingredients
        </SectionHeading>
        <ul>
          {ingredients.map(ingredient => (
            <li className={styles.ingredient} key={ingredient.name}>
              <span className={styles.amount}>{ingredient.quantity} {ingredient.unit}</span>
              <span className={styles.ingredientName}>{ingredient.name}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className={styles.section}>
        <SectionHeading addLabel="Add a method" editHref={hasMethod ? undefined : editHref}>
          Method
        </SectionHeading>
        <Method method={recipe.method} />
      </div>
    </>
  )
}

export default Recipe;
