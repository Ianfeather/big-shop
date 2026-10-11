import type { ListIngredient } from '../types/models';

// Split out of components/shopping-list/ShoppingList so pages/list.tsx can
// ask the same question - whether the Shopping List has anything on it at
// all - without a second, hand-copied computation that could silently drift
// from the one ShoppingList itself renders against. Both now import this.
export function hasListItems(
  shoppingList: Record<string, ListIngredient>,
  extras: Record<string, ListIngredient>
): boolean {
  return !!Object.keys(shoppingList).length || !!Object.keys(extras).length;
}
