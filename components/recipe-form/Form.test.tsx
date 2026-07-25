import { ComponentProps, createElement, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const pushMock = vi.fn();
vi.mock('next/router', () => ({ useRouter: () => ({ push: pushMock }) }));

const unitsMock = [{ id: 1, name: 'gram' }, { id: 2, name: '' }];
const tagsMock = ['Vegetarian', 'Batch Cook'];
const ingredientsMock = [{ name: 'egg' }, { name: 'flour' }];

// /units, /tags and /ingredients are fetched via these TanStack Query hooks
// now (see follow-ups.md #20).
vi.mock('@hooks/use-units', () => ({ default: () => unitsMock }));
vi.mock('@hooks/use-tags', () => ({ default: () => tagsMock }));
vi.mock('@hooks/use-ingredient-names', () => ({ default: () => ingredientsMock.map(i => i.name) }));
vi.mock('@hooks/use-auth', () => ({ default: vi.fn() }));

// POST/PUT/DELETE /recipe and POST /api/parse-recipe-text go through
// useMutation now, wired to these - mocked at the transport boundary so the
// real useMutation/useAuth machinery still runs.
vi.mock('../../lib/api-client', () => ({
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  nextApiPost: vi.fn()
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

// A fresh QueryClient per test avoids cache bleed between tests/renders.
function createWrapper() {
  const queryClient = new QueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

async function renderForm(props: Partial<ComponentProps<typeof Form>> = {}) {
  render(<Form {...props} />, { wrapper: createWrapper() });
  await waitFor(() => expect(screen.getByText('Vegetarian')).toBeInTheDocument());
}

describe('Form', () => {
  it('renders nothing in edit mode when there is no recipe id yet', () => {
    const { container } = render(<Form mode="edit" />, { wrapper: createWrapper() });
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

  it('deletes an ingredient row', async () => {
    await renderForm({
      initialRecipe: {
        id: 1,
        name: 'Omelette',
        remoteUrl: '',
        notes: '',
        method: '',
        tags: [],
        ingredients: [{ name: 'egg', quantity: '2', unit: '' }]
      }
    });

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

  it('shows an error and keeps the typed text when bulk parsing fails', async () => {
    mockedNextApiPost.mockRejectedValue(new Error('Could not parse that'));
    await renderForm();

    await userEvent.type(screen.getByLabelText('Ingredients'), '2 eggs');
    await userEvent.click(screen.getByText('Parse ingredients'));

    await waitFor(() => expect(screen.getByText('Could not parse that')).toBeInTheDocument());
    expect(screen.getByLabelText('Ingredients')).toHaveValue('2 eggs');
  });

  it('redirects to the new recipe after a successful submit', async () => {
    await renderForm();

    await userEvent.type(screen.getByLabelText(/Recipe Name/), 'Omelette');
    await userEvent.click(screen.getByText('Save Recipe'));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/recipes/42?stored=new'));
    expect(mockedApiPost).toHaveBeenCalledWith('/recipe', 'test-token', expect.objectContaining({ name: 'Omelette' }));
  });
});
