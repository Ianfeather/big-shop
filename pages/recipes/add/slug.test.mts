import { createElement } from 'react';
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Colocated under pages/, so this must be .mts rather than .ts: Next treats
// every file under pages/ whose extension is in pageExtensions as a route, and
// a test file has no default export, which fails the build outright from Next
// 16. See CLAUDE.md's Testing section.
//
// .mts cannot hold JSX, hence createElement - the same dodge Form.test.tsx uses
// for its wrapper. .mtsx would allow JSX and is equally invisible to Next, but
// tsconfig's include names `pages/**/*.mts`, so it would silently stop being
// type-checked.

const replaceMock = vi.fn();
const queryRef: { slug?: string | string[] } = { slug: 'store-cupboard-tomato-pasta' };

vi.mock('next/router', () => ({
  useRouter: () => ({ isReady: true, query: queryRef, replace: replaceMock }),
}));
vi.mock('@hooks/use-auth', () => ({
  default: () => ({ getAccessTokenSilently: async () => 'test-token' }),
}));
vi.mock('../../../lib/analytics/events', () => ({ recipeImported: vi.fn() }));
vi.mock('../../../lib/api-client', async () => {
  // ApiError is the real class - the page branches on `instanceof`, so a stub
  // would make the "not available" test pass for the wrong reason.
  const actual = await vi.importActual<typeof import('../../../lib/api-client')>('../../../lib/api-client');
  return { ...actual, apiPost: vi.fn() };
});

import { apiPost, ApiError } from '../../../lib/api-client';
import { recipeImported } from '../../../lib/analytics/events';
import AddFeaturedRecipe from './[slug]';

const mockedApiPost = apiPost as unknown as Mock;
const mockedRecipeImported = recipeImported as unknown as Mock;

describe('landing on a Featured Recipe link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryRef.slug = 'store-cupboard-tomato-pasta';
  });

  it('copies the Recipe and replaces itself with the copy', async () => {
    mockedApiPost.mockResolvedValue({ id: 42, alreadyHad: false });

    render(createElement(AddFeaturedRecipe));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/recipes/42?stored=featured'));
    expect(mockedApiPost).toHaveBeenCalledWith('/recipe/featured/store-cupboard-tomato-pasta', 'test-token');
  });

  // Arriving at a Recipe you already own, with no explanation, reads as the
  // link having done nothing - so the two outcomes are told apart in the URL
  // the page hands on.
  it('says so when the Recipe was already there', async () => {
    mockedApiPost.mockResolvedValue({ id: 42, alreadyHad: true });

    render(createElement(AddFeaturedRecipe));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/recipes/42?stored=already'));
  });

  // A second tap on the same email link is not a new Recipe arriving, and
  // counting it would report an arrival rate the collection does not show.
  it('counts a copy once, and not at all on a repeat visit', async () => {
    mockedApiPost.mockResolvedValue({ id: 42, alreadyHad: false });
    render(createElement(AddFeaturedRecipe));
    await waitFor(() => expect(mockedRecipeImported).toHaveBeenCalledWith('featured'));

    vi.clearAllMocks();
    mockedApiPost.mockResolvedValue({ id: 42, alreadyHad: true });
    render(createElement(AddFeaturedRecipe));

    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    expect(mockedRecipeImported).not.toHaveBeenCalled();
  });

  // The state ADR-0011 says will happen: the template's slugs live in the repo,
  // the flag lives in the production database, and nothing in CI can compare
  // them. It has to be a real page, not a 500 and not a silent bounce.
  it('shows a real page when the slug is not published', async () => {
    mockedApiPost.mockRejectedValue(new ApiError('POST failed with status 404', 404));

    render(createElement(AddFeaturedRecipe));

    expect(await screen.findByText('Recipe not available')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'your recipes' })).toHaveAttribute('href', '/recipes');
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('distinguishes a real failure from an unpublished slug', async () => {
    mockedApiPost.mockRejectedValue(new ApiError('POST failed with status 500', 500));

    render(createElement(AddFeaturedRecipe));

    expect(await screen.findByText('Couldn’t add the recipe')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  // Both failure states have to say this. The feature's whole promise is that
  // the link is additive and safe; a page that just says "error" leaves the
  // reader wondering what it did to their collection.
  it('says nothing changed, whichever way it failed', async () => {
    mockedApiPost.mockRejectedValue(new ApiError('POST failed with status 500', 500));

    render(createElement(AddFeaturedRecipe));

    expect(await screen.findByText(/nothing has changed in your collection/i)).toBeInTheDocument();
  });

  it('adds nothing while it is still working', () => {
    mockedApiPost.mockReturnValue(new Promise(() => {}));

    render(createElement(AddFeaturedRecipe));

    expect(screen.getByText('Adding the recipe')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
