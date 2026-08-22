// Fetch helpers backing every hooks/use-*.ts query and useMutation call
// site - see follow-ups.md #20. Two families:
//  - apiGet/apiPost/apiPut/apiPatch/apiDelete: the Go API (NEXT_PUBLIC_API_HOST),
//    bearer-token authenticated.
//  - nextApiGet/nextApiPost/nextApiPostFormData: this app's own Next.js API
//    routes (pages/api/*, see technical-architecture.md's "Next.js API
//    Routes" section), error-shaped as `{ error: string }` on failure. None of
//    them verifies a token itself; each forwards it to the Go API, which is
//    the only thing that can. The parse routes do that to read canonical
//    Ingredient/Unit names server-side (lib/recipe-import/known-names.ts);
//    /api/recipe-image does it to authenticate the caller at all
//    (lib/authenticate.ts), and rejects a request without one. Hence the
//    optional token on all three.
//
// The `url` passed to the nextApi* helpers must be a **relative** path
// (`/api/parse-recipe-url`), so the browser resolves it against the origin the
// page is being served from. These used to be prefixed with the build-time
// `NEXT_PUBLIC_HOST`, which .env.production pins to www.bigshop.life - so on a
// Netlify deploy preview they were cross-origin calls into *production's* API
// routes (follow-ups.md #48). Nothing about these routes wants an absolute URL:
// they are served by this same Next.js app. lib/app-origin.ts covers the cases
// that genuinely need an origin.

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  return text ? JSON.parse(text) : undefined;
}

// A failed call to the Go API, carrying the status that caused it.
//
// The helpers below used to throw a bare Error whose only account of what
// happened was the status interpolated into its *message*, so a caller wanting
// to treat one status differently from the rest had to match on a string it did
// not own. Nobody needed to until now: hooks/use-account-setup.ts has to tell
// the 409 that means "this address already has an account under another login
// provider" apart from every other way POST /user can fail, because the two want
// opposite handling - one is a screen the user must read, the other is
// deliberately swallowed so a broken upsert cannot strand them on a blank page.
//
// Deliberately not extended to the nextApi* family below. Those routes are
// error-shaped as `{ error: string }` and their callers render that message;
// none of them branches on a status, so giving them a status too would be
// inventing a contract nothing asks for.
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function apiGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_HOST}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    throw new ApiError(`GET ${path} failed with status ${res.status}`, res.status);
  }
  return parseBody(res) as Promise<T>;
}

async function apiMutate<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, token: string, body?: unknown): Promise<T> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_HOST}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    throw new ApiError(`${method} ${path} failed with status ${res.status}`, res.status);
  }
  return parseBody(res) as Promise<T>;
}

export const apiPost = <T>(path: string, token: string, body?: unknown) => apiMutate<T>('POST', path, token, body);
export const apiPut = <T>(path: string, token: string, body?: unknown) => apiMutate<T>('PUT', path, token, body);
export const apiPatch = <T>(path: string, token: string, body?: unknown) => apiMutate<T>('PATCH', path, token, body);
export const apiDelete = <T>(path: string, token: string, body?: unknown) => apiMutate<T>('DELETE', path, token, body);

async function handleNextApiResponse<T>(res: Response, label: string): Promise<T> {
  const data = await parseBody(res);
  if (!res.ok) {
    throw new Error((data as { error?: string } | undefined)?.error ?? `${label} failed with status ${res.status}`);
  }
  return data as T;
}

export async function nextApiGet<T>(url: string, token?: string): Promise<T> {
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
  });
  return handleNextApiResponse<T>(res, `GET ${url}`);
}

export async function nextApiPost<T>(url: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
  return handleNextApiResponse<T>(res, `POST ${url}`);
}

export async function nextApiPostFormData<T>(url: string, formData: FormData, token?: string): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    // No Content-Type: the browser sets it, with the multipart boundary.
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData
  });
  return handleNextApiResponse<T>(res, `POST ${url}`);
}
