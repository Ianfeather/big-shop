import { createElement, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@hooks/use-auth', () => ({ default: vi.fn() }));

// Mocked at the transport boundary, like Form.test.tsx does, so the real
// useMutation/useQuery/useAuth machinery still runs.
vi.mock('../../lib/api-client', () => ({
  nextApiPost: vi.fn(),
  nextApiGet: vi.fn(),
  nextApiPostFormData: vi.fn()
}));

// Canvas has no implementation in jsdom, and resizing is not what any of this
// is about - the photo tests only care what gets uploaded and what comes back.
vi.mock('../../lib/resize-image', () => ({
  resizeImage: vi.fn(async () => new Blob(['x'], { type: 'image/jpeg' }))
}));

import useAuth from '@hooks/use-auth';
import { nextApiPost, nextApiGet, nextApiPostFormData } from '../../lib/api-client';
import MethodImport from './index';

const mockedUseAuth = useAuth as unknown as Mock;
const mockedNextApiPost = nextApiPost as unknown as Mock;
const mockedNextApiGet = nextApiGet as unknown as Mock;
const mockedNextApiPostFormData = nextApiPostFormData as unknown as Mock;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_HOST', 'http://app.test');
  mockedUseAuth.mockReturnValue({ getAccessTokenSilently: vi.fn(async () => 'test-token') });
  mockedNextApiPost.mockReset();
  mockedNextApiGet.mockReset();
  mockedNextApiPostFormData.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function renderImport(props: Partial<React.ComponentProps<typeof MethodImport>> = {}) {
  const onMethod = vi.fn();
  const queryClient = new QueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  }
  const { container } = render(<MethodImport currentMethod="" onMethod={onMethod} {...props} />, { wrapper: Wrapper });
  // The file input is hidden behind the button that clicks it, so there is no
  // accessible name to find it by - and a data-testid would be the only one in
  // the codebase.
  const fileInput = () => container.querySelector('input[type="file"]') as HTMLInputElement;
  return { onMethod, fileInput };
}

const photoFile = () => new File(['photo-bytes'], 'page.jpg', { type: 'image/jpeg' });

describe('MethodImport', () => {
  it('opens straight onto the link field when the cook came here to add a method', () => {
    renderImport({ defaultOpen: true });
    expect(screen.getByLabelText('Recipe link')).toBeInTheDocument();
  });

  it('starts closed otherwise, so an ordinary edit is not interrupted', () => {
    renderImport();
    expect(screen.queryByLabelText('Recipe link')).not.toBeInTheDocument();
  });

  it('fills in an empty method from a link', async () => {
    mockedNextApiPost.mockResolvedValue({ method: '1. Beat the eggs\n2. Fry them' });
    const { onMethod } = renderImport({ defaultOpen: true });

    await userEvent.type(screen.getByLabelText('Recipe link'), 'https://example.com/recipe');
    await userEvent.click(screen.getByText('Fetch'));

    await waitFor(() => expect(onMethod).toHaveBeenCalledWith('1. Beat the eggs\n2. Fry them'));
    expect(mockedNextApiPost).toHaveBeenCalledWith(
      'http://app.test/api/parse-method-url',
      { url: 'https://example.com/recipe' },
      'test-token'
    );
  });

  // The pencil only appears while the Method is empty, but nothing stops
  // someone opening this on a Recipe that has one - and the method they already
  // wrote is not something to overwrite because a fetch happened to land.
  it('offers rather than applies when there is already a method to lose', async () => {
    mockedNextApiPost.mockResolvedValue({ method: '1. Imported step' });
    const { onMethod } = renderImport({ defaultOpen: true, currentMethod: '1. Something I typed' });

    await userEvent.type(screen.getByLabelText('Recipe link'), 'https://example.com/recipe');
    await userEvent.click(screen.getByText('Fetch'));

    await waitFor(() => expect(screen.getByText('1. Imported step')).toBeInTheDocument());
    expect(onMethod).not.toHaveBeenCalled();

    await userEvent.click(screen.getByText('Replace the method'));
    expect(onMethod).toHaveBeenCalledWith('1. Imported step');
  });

  it('throws the offered method away when the cook keeps their own', async () => {
    mockedNextApiPost.mockResolvedValue({ method: '1. Imported step' });
    const { onMethod } = renderImport({ defaultOpen: true, currentMethod: '1. Something I typed' });

    await userEvent.type(screen.getByLabelText('Recipe link'), 'https://example.com/recipe');
    await userEvent.click(screen.getByText('Fetch'));

    await waitFor(() => expect(screen.getByText('1. Imported step')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Keep what I have'));

    expect(screen.queryByText('1. Imported step')).not.toBeInTheDocument();
    expect(onMethod).not.toHaveBeenCalled();
  });

  it('surfaces the route error rather than failing silently', async () => {
    mockedNextApiPost.mockRejectedValue(new Error('No method could be read from that page.'));
    const { onMethod } = renderImport({ defaultOpen: true });

    await userEvent.type(screen.getByLabelText('Recipe link'), 'https://example.com/recipe');
    await userEvent.click(screen.getByText('Fetch'));

    await waitFor(() => expect(screen.getByText('No method could be read from that page.')).toBeInTheDocument());
    expect(onMethod).not.toHaveBeenCalled();
  });

  it('does not call the route for something that is not a link', async () => {
    const { onMethod } = renderImport({ defaultOpen: true });

    await userEvent.type(screen.getByLabelText('Recipe link'), 'my cookbook');
    await userEvent.click(screen.getByText('Fetch'));

    await waitFor(() => expect(screen.getByText(/does not look like a link/)).toBeInTheDocument());
    expect(mockedNextApiPost).not.toHaveBeenCalled();
    expect(onMethod).not.toHaveBeenCalled();
  });

  // mode=method is the only thing separating this from a whole-recipe photo
  // import on the shared /api/recipe-image route.
  it('uploads a photo as a method-only import and applies what the job returns', async () => {
    mockedNextApiPostFormData.mockResolvedValue({ jobId: 'job-1' });
    mockedNextApiGet.mockResolvedValue({ status: 'completed', result: { method: '1. From the book' } });
    const { onMethod, fileInput } = renderImport();

    await userEvent.click(screen.getByText('From a photo'));
    await userEvent.upload(fileInput(), photoFile());

    await waitFor(() => expect(onMethod).toHaveBeenCalledWith('1. From the book'));

    const [, formData] = mockedNextApiPostFormData.mock.calls[0];
    expect(formData.get('mode')).toBe('method');
    expect(formData.get('image')).toBeTruthy();
  });

  it('reports a photo job that fails', async () => {
    mockedNextApiPostFormData.mockResolvedValue({ jobId: 'job-1' });
    mockedNextApiGet.mockResolvedValue({ status: 'failed', error: 'The photo was too blurry to read.' });
    const { onMethod, fileInput } = renderImport();

    await userEvent.click(screen.getByText('From a photo'));
    await userEvent.upload(fileInput(), photoFile());

    await waitFor(() => expect(screen.getByText('The photo was too blurry to read.')).toBeInTheDocument());
    expect(onMethod).not.toHaveBeenCalled();
  });

  // A page with an ingredient list and no instructions extracts to an empty
  // string. Handing that to the form would clear the field and look like the
  // import worked.
  it('says so rather than applying an empty method', async () => {
    mockedNextApiPost.mockResolvedValue({ method: '   ' });
    const { onMethod } = renderImport({ defaultOpen: true });

    await userEvent.type(screen.getByLabelText('Recipe link'), 'https://example.com/recipe');
    await userEvent.click(screen.getByText('Fetch'));

    await waitFor(() => expect(screen.getByText(/did not contain a method/)).toBeInTheDocument());
    expect(onMethod).not.toHaveBeenCalled();
  });
});
