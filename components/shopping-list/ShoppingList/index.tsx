import styles from './index.module.css'
import Item from './Item';
import ClearList from './clear-list';
import PageHeading from '@components/page-heading';
import EmptyState from '@components/empty-state';
import EmptyBasketIllustration from '@components/svg/empty-basket';
import { ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import useSyncedFlag from '@hooks/use-synced-flag';
import useUser from '@hooks/use-user';
import useAuth from '@hooks/use-auth';
import { apiPatch } from '../../../lib/api-client';
import { queryKeys } from '../../../lib/query-keys';
import type { ListIngredient, User } from '../../../types/models';

// Per User, not per Account: the Shopping List itself is shared - you and
// whoever you share it with see the same items - but whether the salt is
// showing is about the list in your hand. Two people shopping off one list
// shouldn't have to agree.
//
// Kept in localStorage as well as on the server, so the first paint is right
// without waiting for a request. See use-synced-flag.ts for why the server is
// still the source of truth.
const SHOW_STAPLES_KEY = 'bigshop:show-pantry-staples';

// Shopping order: non-perishables first, vegetables last since they bruise
// if left sitting in the trolley/bags. Departments not in this list (or a
// missing department) sort after everything else.
const DEPARTMENT_ORDER = ['meat and fish', 'other', 'vegetables'];

function departmentPriority(department: string): number {
  const index = DEPARTMENT_ORDER.indexOf(department);
  return index === -1 ? DEPARTMENT_ORDER.length : index;
}

function sortByDepartment(shoppingList: Record<string, ListIngredient>) {
  return (_a: string, _b: string) => departmentPriority(shoppingList[_a].department) - departmentPriority(shoppingList[_b].department);
}

interface ShoppingListProps {
  shoppingList: Record<string, ListIngredient>;
  extras: Record<string, ListIngredient>;
  buyIngredient: (name: string, type: 'ingredient' | 'extra') => void;
  clearList: () => void;
  // Rendered directly under the masthead, above the list itself. A slot rather
  // than the page stacking something above this component, because this owns
  // the PageHeading - so anything the page put before it would sit above the
  // page's own title, which reads as a layout mistake rather than as a notice
  // about the page.
  //
  // Deliberately not a `showAccountLinkPrompt` boolean: what goes here is the
  // page's business, and one route rendering one thing does not need this
  // component to know what that thing is.
  notice?: ReactNode;
}

const ShoppingList = ({ shoppingList, extras, buyIngredient, clearList, notice }: ShoppingListProps) => {
  const user = useUser();
  const { getAccessTokenSilently } = useAuth();
  const queryClient = useQueryClient();

  // Writes the preference through and seeds the cache with what came back, so
  // the ['user'] query and localStorage agree without a refetch. No
  // invalidation: the response *is* the new state, and re-reading it would only
  // reintroduce the round trip this whole arrangement exists to paint through.
  const preferenceMutation = useMutation({
    mutationFn: async (showPantryStaples: boolean) => {
      const token = await getAccessTokenSilently();
      return apiPatch<User>('/user/preferences', token, { showPantryStaples });
    },
    onSuccess: (saved) => queryClient.setQueryData(queryKeys.user, saved),
    // A view preference is not worth surfacing an error for: the toggle has
    // already moved, and the next load reconciles against the server.
    onError: (e) => console.error(e)
  });

  const [showStaples, setShowStaples] = useSyncedFlag(
    SHOW_STAPLES_KEY,
    false,
    user?.showPantryStaples,
    (next) => preferenceMutation.mutate(next)
  );

  const boughtItems = Object.keys(shoppingList).filter((name => shoppingList[name].isBought));
  const boughtExtras = Object.keys(extras).filter((name => extras[name].isBought));
  const hasListItems = !!Object.keys(shoppingList).length || !!Object.keys(extras).length;
  const hasBoughtItems = !!boughtItems.length || !!boughtExtras.length;

  // Pantry staples split out of the main list rather than being filtered away.
  // The server sends every Item and marks the staples (MarkPantryStaples in the
  // Go API), so the toggle is instant and, crucially, the shopper can always see
  // that the things exist. Recipe Import used to drop them from the Recipe
  // outright, which was indistinguishable from having lost them.
  //
  // Staples stay grouped even with the toggle on: "show me the salt" is not the
  // same as "shuffle the salt in among the things I actually came for".
  const unbought = Object.keys(shoppingList).filter(name => !shoppingList[name].isBought);
  const ingredients = unbought
    .filter(name => !shoppingList[name].pantryStaple)
    .sort(sortByDepartment(shoppingList));
  const staples = unbought
    .filter(name => shoppingList[name].pantryStaple)
    .sort(sortByDepartment(shoppingList));

  return (
    <>
      {/* Clear list sits up here on the masthead rather than at the foot of the
          list: it used to be the page's only footer, stranded below however many
          items you had, and this is where the (now deleted) item count was. */}
      <PageHeading action={hasListItems ? <ClearList onClick={clearList} /> : undefined}>
        Your shopping list
      </PageHeading>
      { notice }
      { !hasListItems && (
          <EmptyState
            illustration={EmptyBasketIllustration}
            illustrationLabel="Empty shopping basket"
            title="Your shopping list is empty"
          >
            Tick a recipe and its ingredients land here &mdash; added up across everything
            you&rsquo;ve picked, in the order you walk the shop.
          </EmptyState>
      )}
      <ul className={styles.shoppingList}>
        { ingredients.map((name, i) => (
          <Item type='ingredient' name={name} item={shoppingList[name]} bought={false} handleClick={buyIngredient} key={i}/>
        ))}
        { Object.keys(extras).filter((name => !extras[name].isBought)).map((name, i) => (
          <Item type='extra' name={name} bought={false} handleClick={buyIngredient} key={i}/>
        ))}
      </ul>
      {
        !!staples.length && (
          <div className={styles.staplesContainer}>
            {/* A real button rather than <details>: the open state has to come
                from localStorage so it survives a reload, and <details> owns
                that itself. aria-expanded/aria-controls give it the same
                semantics. */}
            <button
              type="button"
              className={styles.staplesToggle}
              aria-expanded={showStaples}
              aria-controls="pantry-staples"
              onClick={() => setShowStaples(!showStaples)}
            >
              <span className={`${styles.staplesChevron} ${showStaples ? styles.staplesChevronOpen : ''}`} aria-hidden="true" />
              Pantry staples ({staples.length})
              <span className={styles.staplesHint}>{showStaples ? 'hide' : 'show'}</span>
            </button>
            {/* Rendered either way so the count above is never the only evidence
                these exist, and so a screen reader's tab order doesn't change
                shape when the group opens. */}
            <ul className={styles.shoppingList} id="pantry-staples" hidden={!showStaples}>
              { staples.map((name, i) => (
                <Item type='ingredient' name={name} item={shoppingList[name]} bought={false} handleClick={buyIngredient} key={i}/>
              ))}
            </ul>
          </div>
        )
      }
      {
        hasBoughtItems && (
          <div className={styles.boughtContainer}>
            <h2>Already bought</h2>
            <ul className={styles.shoppingList}>
              { boughtItems.map((name, i) => (
                <Item type='ingredient' name={name} item={shoppingList[name]} bought={true} handleClick={buyIngredient} key={i}/>
              ))}
              { boughtExtras.map((name, i) => (
                <Item type='extra' name={name} bought={true} handleClick={buyIngredient} key={i}/>
              ))}
            </ul>
          </div>
        )
      }
    </>
  )
}

export default ShoppingList;
