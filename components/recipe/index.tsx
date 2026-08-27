import { ReactNode } from 'react';
import Link from 'next/link';
import TagPill from '@components/tag-pill';
import icons from '@components/svg';
import styles from './index.module.css';

const PencilIcon = icons.pencil;
import type { Recipe as RecipeModel } from '../../types/models';

// The only place in the app where stored data becomes an href, and therefore
// the only place a scheme test is load-bearing. `remoteUrl` is a free-text
// field on the edit form and an Account is shared between Users, so the value
// rendered here need not have been typed by the person about to click it -
// which is what makes `javascript:` worth excluding by rule rather than by
// trusting whoever authored the Recipe.
//
// Anchored on the scheme rather than the bare `/^http/` prefix test this used
// to be. That test did exclude `javascript:`, but only as a side effect of
// what it happened to allow; a prefix is a weaker thing to rest on than a
// scheme, and it read as an accident rather than a decision. Anything that
// fails renders as plain text, which React escapes.
const SAFE_LINK_SCHEME = /^https?:\/\//i;

const RecipeLink = ({ link }: { link?: string | null }) => {
  if (!link) return false;
  if (SAFE_LINK_SCHEME.test(link)) {
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
//
// The Method pencil carries ?add=method, which scrolls the edit form to the
// Method and opens Method Import - so the answer to "this has no method" can be
// the original link or a photo of the cookbook page, not only typing it out.
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
      {/* Shown to everyone who can see this Recipe, not gated on being an
          admin, and that is the point rather than an oversight. Only an admin's
          own Account holds a Featured Recipe, so nobody else will ever see this
          - and ADR-0011 accepts that ordinary edits to these rows change what
          every new user receives. The curator therefore has to be able to tell,
          from the Recipe itself, that they are editing something published.
          Hiding it behind the edit form is where that goes wrong. */}
      { recipe.featured && (
        <p className={styles.featured}>
          Featured &mdash; anyone can add this recipe to their own collection.
        </p>
      )}
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
        <SectionHeading addLabel="Add a method" editHref={hasMethod || !editHref ? undefined : `${editHref}?add=method`}>
          Method
        </SectionHeading>
        <Method method={recipe.method} />
      </div>
    </>
  )
}

export default Recipe;
