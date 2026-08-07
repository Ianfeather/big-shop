import { createElement, type ComponentProps, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ListIngredient } from '../../../types/models';

vi.mock('@hooks/use-auth', () => ({ default: vi.fn() }));
// Mocked at the transport boundary, so the real useQuery/useMutation machinery
// still runs - the same shape as components/recipe-form/Form.test.tsx.
vi.mock('../../../lib/api-client', () => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn()
}));

import useAuth from '@hooks/use-auth';
import { apiGet, apiPatch } from '../../../lib/api-client';
import ShoppingList from './index';

const mockedUseAuth = useAuth as unknown as Mock;
const mockedApiGet = apiGet as unknown as Mock;
const mockedApiPatch = apiPatch as unknown as Mock;

beforeEach(() => {
  // The staples toggle caches in localStorage, so tests would otherwise leak
  // their expanded state into each other.
  window.localStorage.clear();
  mockedUseAuth.mockReturnValue({
    isAuthenticated: true,
    getAccessTokenSilently: vi.fn(async () => 'test-token')
  });
  // The server always states the preference, including when it is false (it's
  // a *bool in the Go type for exactly that reason) - so the mock does too. A
  // mock that omitted it would hide the race the reconciliation guard exists
  // to prevent, since an absent value makes the effect bail out early.
  mockedApiGet.mockResolvedValue({ id: 'u1', email: 'a@b.c', showPantryStaples: false });
  mockedApiPatch.mockImplementation(async (_path, _token, body) => ({ id: 'u1', email: 'a@b.c', ...(body as object) }));
});

// A fresh QueryClient per render keeps the ['user'] cache from bleeding
// between tests.
function renderList(props: ComponentProps<typeof ShoppingList>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  }
  return render(<ShoppingList {...props} />, { wrapper: Wrapper });
}

// Extra Items carry no Amounts and placeholder department/recipe_id values in
// the real API (see CONTEXT.md's Shopping List Item entry) - this mirrors
// that so fixtures satisfy ListIngredient without pretending those fields
// are meaningful for an extra.
const ingredient = (overrides: Partial<ListIngredient> = {}): ListIngredient => ({
  amounts: [], department: '', recipe_id: 0, isBought: false, ...overrides
});

describe('ShoppingList', () => {
  it('shows an empty-basket illustration and no clear button when there is nothing to buy', () => {
    renderList({ shoppingList: {}, extras: {}, buyIngredient: () => {}, clearList: () => {} });

    expect(screen.getByRole('img', { name: /empty shopping basket/i })).toBeInTheDocument();
    expect(screen.getByText(/your shopping list is empty/i)).toBeInTheDocument();
    expect(screen.queryByText(/clear list/i)).not.toBeInTheDocument();
  });

  it('lists unbought ingredients and extras, and calls buyIngredient with name/type on click', async () => {
    const buyIngredient = vi.fn();
    renderList({
      shoppingList: { chicken: ingredient({ amounts: [{ quantity: '1', unit: 'kg' }], department: 'meat and fish' }) },
      extras: { beer: ingredient() },
      buyIngredient,
      clearList: () => {}
    });

    expect(screen.getByText('chicken')).toBeInTheDocument();
    expect(screen.getByText('beer')).toBeInTheDocument();
    expect(screen.queryByText('Already bought')).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('chicken'));
    expect(buyIngredient).toHaveBeenCalledWith('chicken', 'ingredient');

    await userEvent.click(screen.getByText('beer'));
    expect(buyIngredient).toHaveBeenCalledWith('beer', 'extra');
  });

  it('separates bought ingredients/extras into an "Already bought" section', () => {
    renderList({
      shoppingList: {
        chicken: ingredient({ amounts: [{ quantity: '1', unit: 'kg' }], department: 'meat and fish' }),
        rice: ingredient({ amounts: [{ quantity: '300', unit: 'gram' }], department: 'other', isBought: true })
      },
      extras: { beer: ingredient({ isBought: true }) },
      buyIngredient: () => {},
      clearList: () => {}
    });

    expect(screen.getByText('Already bought')).toBeInTheDocument();
    const boughtSection = screen.getByText('Already bought').closest('div');
    expect(boughtSection).toHaveTextContent('rice');
    expect(boughtSection).toHaveTextContent('beer');
    expect(boughtSection).not.toHaveTextContent('chicken');
  });

  it('groups items sharing a department together rather than interleaving them', () => {
    renderList({
      shoppingList: {
        carrot: ingredient({ amounts: [{ quantity: '2', unit: '' }], department: 'vegetables' }),
        potato: ingredient({ amounts: [{ quantity: '1', unit: 'kg' }], department: 'vegetables' }),
        chicken: ingredient({ amounts: [{ quantity: '1', unit: 'kg' }], department: 'meat and fish' })
      },
      extras: {},
      buyIngredient: () => {},
      clearList: () => {}
    });

    const names = screen.getAllByRole('listitem').map(li => li.textContent ?? '');
    const vegetableIndices = ['carrot', 'potato'].map(name => names.findIndex(t => t.includes(name)));
    expect(Math.abs(vegetableIndices[0] - vegetableIndices[1])).toBe(1);
  });

  // Pantry staples. The behaviour these lock in is the fix for a real
  // complaint: Recipe Import used to drop salt/oil/sugar from a Recipe outright,
  // which is indistinguishable from a failed extraction. They now reach the
  // Shopping List like anything else and are grouped, never silently absent.
  describe('pantry staples', () => {
    const listWithStaples = {
      chicken: ingredient({ amounts: [{ quantity: '1', unit: 'kg' }], department: 'meat and fish' }),
      'olive oil': ingredient({ amounts: [{ quantity: '30', unit: 'millilitre' }], pantryStaple: true }),
      salt: ingredient({ amounts: [{ quantity: '1', unit: 'pinch' }], pantryStaple: true })
    };

    const renderStaples = () => renderList({
      shoppingList: listWithStaples, extras: {}, buyIngredient: () => {}, clearList: () => {}
    });

    it('keeps staples out of the main list but always says how many there are', () => {
      renderStaples();

      // The count is the point: hidden is fine, invisible is not.
      expect(screen.getByRole('button', { name: /pantry staples \(2\)/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /pantry staples/i })).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByText('chicken')).toBeInTheDocument();
    });

    it('reveals the staples on click and keeps them in their own group', async () => {
      renderStaples();
      const toggle = screen.getByRole('button', { name: /pantry staples/i });

      await userEvent.click(toggle);

      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const group = document.getElementById('pantry-staples');
      expect(group).toHaveTextContent('olive oil');
      expect(group).toHaveTextContent('salt');
      // Shown, but still not shuffled in among the things you came for.
      expect(group).not.toHaveTextContent('chicken');
    });

    it('remembers the choice across a remount', async () => {
      const { unmount } = renderStaples();
      await userEvent.click(screen.getByRole('button', { name: /pantry staples/i }));
      unmount();

      renderStaples();

      expect(screen.getByRole('button', { name: /pantry staples/i })).toHaveAttribute('aria-expanded', 'true');
    });

    // The preference is stored on the User but painted from localStorage, so
    // the first render never waits on a request. These pin down the contract
    // between the two halves (hooks/use-synced-flag.ts).
    it('saves the choice to the server as well as locally', async () => {
      renderStaples();

      await userEvent.click(screen.getByRole('button', { name: /pantry staples/i }));

      await waitFor(() => expect(mockedApiPatch).toHaveBeenCalledWith(
        '/user/preferences', 'test-token', { showPantryStaples: true }
      ));
      expect(window.localStorage.getItem('bigshop:show-pantry-staples')).toBe('true');
    });

    // Regression: between the click and the save resolving, the cache is ahead
    // of the server on purpose. The first version of this hook reconciled
    // whenever the two merely *differed*, so it reverted the toggle the instant
    // you pressed it and flipped it back when the response arrived. Whether you
    // saw it depended on a race with the request, so it passed locally and
    // failed in e2e.
    it('does not revert the toggle while the save is still in flight', async () => {
      let resolveSave: (v: unknown) => void = () => {};
      mockedApiPatch.mockReturnValue(new Promise(resolve => { resolveSave = resolve; }));
      renderStaples();
      const toggle = screen.getByRole('button', { name: /pantry staples/i });
      // Let the server's "false" land first, so the stale value is in the cache
      // and available to reconcile against.
      await waitFor(() => expect(mockedApiGet).toHaveBeenCalled());

      await userEvent.click(toggle);

      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      // Still open a tick later, with the request unresolved.
      await new Promise(r => setTimeout(r, 20));
      expect(toggle).toHaveAttribute('aria-expanded', 'true');

      resolveSave({ id: 'u1', email: 'a@b.c', showPantryStaples: true });
      await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'true'));
    });

    // The reason for the localStorage layer at all: a preference read only from
    // the server paints the default first and flips once the request lands,
    // every visit, for everyone who chose the non-default.
    it('paints the cached choice immediately, before the server answers', () => {
      window.localStorage.setItem('bigshop:show-pantry-staples', 'true');
      // Never resolves - the first paint must not be waiting on it.
      mockedApiGet.mockReturnValue(new Promise(() => {}));

      renderStaples();

      expect(screen.getByRole('button', { name: /pantry staples/i })).toHaveAttribute('aria-expanded', 'true');
    });

    // ...and the reason the server is still the source of truth: a choice made
    // on another device has to arrive here. This is the one case where a flip
    // is correct, because the value genuinely changed elsewhere.
    it('adopts the server value when it disagrees with the local cache', async () => {
      window.localStorage.setItem('bigshop:show-pantry-staples', 'false');
      mockedApiGet.mockResolvedValue({ id: 'u1', email: 'a@b.c', showPantryStaples: true });

      renderStaples();

      await waitFor(() => expect(
        screen.getByRole('button', { name: /pantry staples/i })
      ).toHaveAttribute('aria-expanded', 'true'));
      // Written back, so the next paint on this device is right first time.
      expect(window.localStorage.getItem('bigshop:show-pantry-staples')).toBe('true');
    });

    // GET /user 404s for someone who reached the list before POST /user ever
    // ran. Not a fault - there is simply nothing recorded, and the local value
    // stands rather than being reset.
    it('keeps the local choice when the server has no user to read', async () => {
      window.localStorage.setItem('bigshop:show-pantry-staples', 'true');
      mockedApiGet.mockRejectedValue(new Error('404'));

      renderStaples();

      await waitFor(() => expect(mockedApiGet).toHaveBeenCalled());
      expect(screen.getByRole('button', { name: /pantry staples/i })).toHaveAttribute('aria-expanded', 'true');
    });

    it('shows no staples group when nothing on the list is one', () => {
      renderList({
        shoppingList: { chicken: ingredient({ amounts: [{ quantity: '1', unit: 'kg' }] }) },
        extras: {},
        buyIngredient: () => {},
        clearList: () => {}
      });

      expect(screen.queryByRole('button', { name: /pantry staples/i })).not.toBeInTheDocument();
    });
  });

  it('shows the clear-list control whenever there is anything on the list', async () => {
    const clearList = vi.fn();
    renderList({
      shoppingList: { chicken: ingredient({ amounts: [{ quantity: '1', unit: 'kg' }], department: 'meat and fish' }) },
      extras: {},
      buyIngredient: () => {},
      clearList
    });

    expect(screen.getByText(/clear list and start over/i)).toBeInTheDocument();
  });
});
