import { ComponentProps, createElement, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { queryKeys } from '../../lib/query-keys';

const pushMock = vi.fn();
vi.mock('next/router', () => ({ useRouter: () => ({ push: pushMock }) }));

const unitsMock = [{ id: 1, name: 'gram' }, { id: 2, name: '' }];
const tagsMock = ['Vegetarian', 'Batch Cook'];
const ingredientsMock = [{ name: 'egg' }, { name: 'flour' }];

// /units, /tags and /ingredients are fetched via these TanStack Query hooks
// now (see follow-ups.md #20).
vi.mock('@hooks/use-units', () => ({ default: () => unitsMock }));
vi.mock('@hooks/use-tags', () => ({ default: () => tagsMock }));
vi.mock('@hooks/use-auth', () => ({ default: vi.fn() }));

// POST/PUT/DELETE /recipe and POST /api/parse-recipe-text go through
// useMutation now, wired to these - mocked at the transport boundary so the
// real useMutation/useAuth machinery still runs.
vi.mock('../../lib/api-client', () => ({
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  nextApiPost: vi.fn(),
  // Method Import's two, which this form renders in edit mode. Nothing here
  // exercises them - components/method-import/index.test.tsx does.
  nextApiGet: vi.fn(),
  nextApiPostFormData: vi.fn()
}));

import useAuth from '@hooks/use-auth';
import { apiPost, apiPut, apiDelete, nextApiPost } from '../../lib/api-client';
import Form from './Form';

const mockedUseAuth = useAuth as unknown as Mock;
const mockedApiPost = apiPost as unknown as Mock;
const mockedApiPut = apiPut as unknown as Mock;
const mockedApiDelete = apiDelete as unknown as Mock;
const mockedNextApiPost = nextApiPost as unknown as Mock;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_API_HOST', 'http://api.test');
  vi.stubEnv('NEXT_PUBLIC_HOST', 'http://app.test');
  pushMock.mockClear();
  mockedUseAuth.mockReturnValue({ getAccessTokenSilently: vi.fn(async () => 'test-token') });
  mockedApiPost.mockResolvedValue({ status: 'ok', id: 42 });
  mockedApiPut.mockResolvedValue({});
  mockedApiDelete.mockResolvedValue({});
  mockedNextApiPost.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// A fresh QueryClient per test avoids cache bleed between tests/renders. The
// client is returned as well so the cache-invalidation tests below can seed it
// and then assert on what the mutations did to it.
function createWrapper() {
  const queryClient = new QueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  }
  return { queryClient, Wrapper };
}

async function renderForm(props: Partial<ComponentProps<typeof Form>> = {}) {
  const { queryClient, Wrapper } = createWrapper();
  render(<Form {...props} />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByText('Vegetarian')).toBeInTheDocument());
  return queryClient;
}

const editableRecipe = {
  id: 1,
  name: 'Omelette',
  remoteUrl: '',
  notes: '',
  method: '',
  tags: [],
  ingredients: [{ name: 'egg', quantity: '2', unit: '' }]
};

// Seeds every cache a Recipe save/delete is meant to act on. Seeding is what
// makes these assertions meaningful at all: invalidating a key with no entry
// in the cache is a silent no-op, and the hooks that would normally populate
// these are mocked out at the top of this file.
//
// The recipe entry is keyed the way hooks/use-recipe.ts keys it when reading -
// off the router param, i.e. a *string* id - while Form works from Recipe.id,
// a number. queryKeys.recipe() reconciles the two; see lib/query-keys.ts.
function seedCache(queryClient: QueryClient) {
  queryClient.setQueryData(queryKeys.recipes, [{ id: 1, name: 'Omelette', tags: [] }]);
  queryClient.setQueryData(queryKeys.recipe('1'), { ...editableRecipe });
  queryClient.setQueryData(queryKeys.units, unitsMock);
  queryClient.setQueryData(queryKeys.tags, tagsMock);
}

const isInvalidated = (queryClient: QueryClient, key: readonly unknown[]) =>
  queryClient.getQueryState(key)?.isInvalidated === true;

describe('Form', () => {
  it('renders nothing in edit mode when there is no recipe id yet', () => {
    const { container } = render(<Form mode="edit" />, { wrapper: createWrapper().Wrapper });
    expect(container).toBeEmptyDOMElement();
  });

  it('toggles a tag on and off', async () => {
    await renderForm();
    const checkbox = screen.getByLabelText('Vegetarian');

    expect(checkbox).not.toBeChecked();
    await userEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    await userEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  // The Unit dropdown is the fetched catalog plus synthetic entries for any
  // unit an imported ingredient carries that the catalog doesn't have yet
  // (the extractor invents things like "bunch"). That reconciliation used to
  // live in two effects writing a `units` useState; it is derived now, and
  // these two lock the behaviour in either way - it had no direct test before.
  it('offers the fetched catalog units for an ingredient', async () => {
    await renderForm({ initialRecipe: editableRecipe });

    const unitNames = screen.getAllByRole('option').map(o => o.textContent);
    expect(unitNames).toContain('Gram');
  });

  it('adds a unit the catalog does not have when an ingredient uses one', async () => {
    await renderForm({
      initialRecipe: {
        ...editableRecipe,
        ingredients: [{ name: 'parsley', quantity: '1', unit: 'bunch' }]
      }
    });

    const unitNames = screen.getAllByRole('option').map(o => o.textContent);
    expect(unitNames).toContain('Bunch');
    // and the catalog entries are still there alongside it
    expect(unitNames).toContain('Gram');
    expect(screen.getByLabelText('Unit')).toHaveValue('bunch');
  });

  it('deletes an ingredient row', async () => {
    await renderForm({ initialRecipe: editableRecipe });

    expect(screen.getByText('egg')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'trash' }));
    expect(screen.queryByText('egg')).not.toBeInTheDocument();
  });

  it('parses bulk-pasted ingredients and appends them to the list', async () => {
    mockedNextApiPost.mockResolvedValue({ ingredients: [{ name: 'egg', quantity: '2', unit: '' }] });
    await renderForm();

    await userEvent.type(screen.getByLabelText('Ingredients'), '2 eggs');
    await userEvent.click(screen.getByText('Parse ingredients'));

    await waitFor(() => expect(screen.getByText('egg')).toBeInTheDocument());
    expect(screen.getByLabelText('Ingredients')).toHaveValue('');
  });

  // Rules the client out of the "pasted six lines, got three" report: whatever
  // the route returns is appended in full, and a repeat parse adds to the list
  // rather than replacing it. The ingredients that went missing were never in
  // the response - see lib/recipe-import/extract.test.ts.
  it('appends every ingredient the route returns, across repeated parses', async () => {
    mockedNextApiPost.mockResolvedValueOnce({
      ingredients: [
        { name: 'tomato ketchup', quantity: '120', unit: 'millilitre' },
        { name: 'pineapple juice', quantity: '120', unit: 'millilitre' },
        { name: 'soy sauce', quantity: '100', unit: 'millilitre' }
      ]
    });
    await renderForm();

    await userEvent.type(screen.getByLabelText('Ingredients'), 'Tomato ketchup: 120ml');
    await userEvent.click(screen.getByText('Parse ingredients'));
    await waitFor(() => expect(screen.getByText('soy sauce')).toBeInTheDocument());

    mockedNextApiPost.mockResolvedValueOnce({
      ingredients: [
        { name: 'jerk marinade', quantity: '120', unit: 'millilitre' },
        { name: 'brown sugar', quantity: '20', unit: 'gram' },
        { name: 'oil', quantity: '22.5', unit: 'millilitre' }
      ]
    });
    await userEvent.type(screen.getByLabelText('Ingredients'), 'Jerk marinade: 120ml');
    await userEvent.click(screen.getByText('Parse ingredients'));

    await waitFor(() => expect(screen.getByText('oil')).toBeInTheDocument());
    for (const name of ['tomato ketchup', 'pineapple juice', 'soy sauce', 'jerk marinade', 'brown sugar']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it('shows an error and keeps the typed text when bulk parsing fails', async () => {
    mockedNextApiPost.mockRejectedValue(new Error('Could not parse that'));
    await renderForm();

    await userEvent.type(screen.getByLabelText('Ingredients'), '2 eggs');
    await userEvent.click(screen.getByText('Parse ingredients'));

    await waitFor(() => expect(screen.getByText('Could not parse that')).toBeInTheDocument());
    expect(screen.getByLabelText('Ingredients')).toHaveValue('2 eggs');
  });

  // Method Import (components/method-import). The form is where it lives; what
  // it does is tested next to it.
  describe('method import', () => {
    it('offers to fill the method in from a link or a photo when editing', async () => {
      await renderForm({ initialRecipe: editableRecipe, mode: 'edit' });

      expect(screen.getByText('From a link')).toBeInTheDocument();
      expect(screen.getByText('From a photo')).toBeInTheDocument();
    });

    // Add New Recipe already offers both sources for the whole recipe, method
    // included, so a method-only importer there would be two controls doing
    // the same job.
    it('leaves it out when creating a recipe', async () => {
      await renderForm();

      expect(screen.queryByText('From a link')).not.toBeInTheDocument();
    });

    it('opens onto the link field when the cook arrived from the Method pencil', async () => {
      await renderForm({ initialRecipe: editableRecipe, mode: 'edit', focusSection: 'method' });

      expect(screen.getByLabelText('Recipe link')).toBeInTheDocument();
    });

    it('stays closed on an ordinary edit', async () => {
      await renderForm({ initialRecipe: editableRecipe, mode: 'edit' });

      expect(screen.queryByLabelText('Recipe link')).not.toBeInTheDocument();
    });

    // The whole point of the feature: what the import returns has to reach the
    // Method field, and from there the save payload.
    it('writes an imported method into the field it is going to save', async () => {
      mockedNextApiPost.mockResolvedValue({ method: '1. Beat the eggs' });
      await renderForm({ initialRecipe: editableRecipe, mode: 'edit', focusSection: 'method' });

      await userEvent.type(screen.getByLabelText('Recipe link'), 'https://example.com/recipe');
      await userEvent.click(screen.getByText('Fetch'));

      await waitFor(() => expect(screen.getByLabelText('Method')).toHaveValue('1. Beat the eggs'));

      await userEvent.click(screen.getByText('Update Recipe'));
      await waitFor(() => expect(mockedApiPut).toHaveBeenCalledWith(
        '/recipe',
        'test-token',
        expect.objectContaining({ method: '1. Beat the eggs' })
      ));
    });
  });

  it('redirects to the new recipe after a successful submit', async () => {
    await renderForm();

    await userEvent.type(screen.getByLabelText(/Recipe Name/), 'Omelette');
    await userEvent.click(screen.getByText('Save Recipe'));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/recipes/42?stored=new'));
    expect(mockedApiPost).toHaveBeenCalledWith('/recipe', 'test-token', expect.objectContaining({ name: 'Omelette' }));
  });

  // Cache invalidation (follow-ups.md #30). These assert on the cache rather
  // than on what the user sees because the failure mode is invisible locally:
  // a missing invalidation still looks right, since navigating away remounts
  // the consumer and refetches anyway. It only shows up as a stale flash.
  describe('cache invalidation', () => {
    it('invalidates the recipe list and units after creating a recipe', async () => {
      const queryClient = await renderForm();
      seedCache(queryClient);

      await userEvent.type(screen.getByLabelText(/Recipe Name/), 'Omelette');
      await userEvent.click(screen.getByText('Save Recipe'));

      await waitFor(() => expect(isInvalidated(queryClient, queryKeys.recipes)).toBe(true));
      // A save upserts every Unit its ingredients reference, so the cached
      // /units list can be missing one the save just created.
      expect(isInvalidated(queryClient, queryKeys.units)).toBe(true);
    });

    // The regression this guards: Form works from Recipe.id (a number) while
    // useRecipe caches under the router's string param. Key them differently
    // and the invalidation silently matches nothing - no error, just a stale
    // Recipe rendered after saving an edit.
    it('invalidates the edited recipe despite reading and writing its id as different types', async () => {
      const queryClient = await renderForm({ initialRecipe: editableRecipe, mode: 'edit' });
      seedCache(queryClient);
      expect(queryClient.getQueryData(queryKeys.recipe('1'))).toBeDefined();

      await userEvent.click(screen.getByText('Update Recipe'));

      await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/recipes/1?stored=updated'));
      expect(isInvalidated(queryClient, queryKeys.recipe(1))).toBe(true);
      expect(isInvalidated(queryClient, queryKeys.recipe('1'))).toBe(true);
      expect(isInvalidated(queryClient, queryKeys.recipes)).toBe(true);
    });

    it('drops the deleted recipe from the cache rather than leaving it to refetch', async () => {
      const queryClient = await renderForm({ initialRecipe: editableRecipe, mode: 'edit' });
      seedCache(queryClient);

      await userEvent.click(screen.getByText('Delete Recipe'));

      await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/recipes'));
      // Removed, not invalidated: refetching a deleted Recipe would 404.
      expect(queryClient.getQueryData(queryKeys.recipe('1'))).toBeUndefined();
      expect(isInvalidated(queryClient, queryKeys.recipes)).toBe(true);
    });

    // The `tag` table is a fixed list the app never inserts into - saving a
    // Recipe only writes recipe_tag join rows - so invalidating here would be
    // a refetch that can never return anything new.
    it('leaves the tag list alone, which a recipe save cannot change', async () => {
      const queryClient = await renderForm();
      seedCache(queryClient);

      await userEvent.type(screen.getByLabelText(/Recipe Name/), 'Omelette');
      await userEvent.click(screen.getByText('Save Recipe'));

      await waitFor(() => expect(isInvalidated(queryClient, queryKeys.recipes)).toBe(true));
      expect(isInvalidated(queryClient, queryKeys.tags)).toBe(false);
    });
  });
});
