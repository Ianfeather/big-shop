import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('use-http', () => ({ default: vi.fn() }));
vi.mock('next/router', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import useFetch from 'use-http';
import Form from './Form';

const unitsMock = [{ id: 1, name: 'gram' }, { id: 2, name: '' }];
const tagsMock = ['Vegetarian', 'Batch Cook'];
const ingredientsMock = [{ name: 'egg' }, { name: 'flour' }];

function makeMainFetch() {
  const response = { ok: true };
  return {
    response,
    loading: false,
    error: null,
    get: vi.fn(async (path) => {
      response.ok = true;
      if (path === '/units') return unitsMock;
      if (path === '/tags') return tagsMock;
      if (path === '/ingredients') return ingredientsMock;
      return [];
    }),
    post: vi.fn(async () => {
      response.ok = true;
      return {};
    }),
    put: vi.fn(async () => {
      response.ok = true;
      return {};
    }),
    del: vi.fn(async () => {
      response.ok = true;
      return {};
    })
  };
}

function makeParseFetch() {
  return {
    response: { ok: true },
    loading: false,
    post: vi.fn()
  };
}

let mainFetch;
let parseFetch;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_API_HOST', 'http://api.test');
  vi.stubEnv('NEXT_PUBLIC_HOST', 'http://app.test');
  mainFetch = makeMainFetch();
  parseFetch = makeParseFetch();
  useFetch.mockImplementation((url) => (url && url.includes('parse-recipe-text') ? parseFetch : mainFetch));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function renderForm(props = {}) {
  render(<Form {...props} />);
  await waitFor(() => expect(screen.getByText('Vegetarian')).toBeInTheDocument());
}

describe('Form', () => {
  it('renders nothing in edit mode when there is no recipe id yet', () => {
    const { container } = render(<Form mode="edit" />);
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
    parseFetch.post.mockImplementation(async () => {
      parseFetch.response.ok = true;
      return { ingredients: [{ name: 'egg', quantity: '2', unit: '' }] };
    });
    await renderForm();

    await userEvent.type(screen.getByLabelText('Ingredients'), '2 eggs');
    await userEvent.click(screen.getByText('Parse ingredients'));

    await waitFor(() => expect(screen.getByText('egg')).toBeInTheDocument());
    expect(screen.getByLabelText('Ingredients')).toHaveValue('');
  });

  it('shows an error and keeps the typed text when bulk parsing fails', async () => {
    parseFetch.post.mockImplementation(async () => {
      parseFetch.response.ok = false;
      return { error: 'Could not parse that' };
    });
    await renderForm();

    await userEvent.type(screen.getByLabelText('Ingredients'), '2 eggs');
    await userEvent.click(screen.getByText('Parse ingredients'));

    await waitFor(() => expect(screen.getByText('Could not parse that')).toBeInTheDocument());
    expect(screen.getByLabelText('Ingredients')).toHaveValue('2 eggs');
  });

  it('shows a stored confirmation after a successful submit', async () => {
    await renderForm();

    await userEvent.type(screen.getByLabelText(/Recipe Name/), 'Omelette');
    await userEvent.click(screen.getByText('Store Recipe'));

    await waitFor(() => expect(screen.getByText('Stored!')).toBeInTheDocument());
    expect(mainFetch.post).toHaveBeenCalledWith('/recipe', expect.objectContaining({ name: 'Omelette' }));
    expect(screen.getByText('Add another recipe')).toBeInTheDocument();
  });
});
