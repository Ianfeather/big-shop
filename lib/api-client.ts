// Fetch helpers backing every hooks/use-*.ts query and useMutation call
// site - see follow-ups.md #20. Two families:
//  - apiGet/apiPost/apiPut/apiPatch/apiDelete: the Go API (NEXT_PUBLIC_API_HOST),
//    bearer-token authenticated.
//  - nextApiGet/nextApiPost/nextApiPostFormData: this app's own Next.js API
//    routes (pages/api/*, see technical-architecture.md's "Next.js API
//    Routes" section), error-shaped as `{ error: string }` on failure. These
//    routes don't validate a token themselves, but the import ones forward
//    one to the Go API to read canonical Ingredient/Unit names server-side
//    (lib/recipe-import/known-names.ts), so they take an optional token.

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  return text ? JSON.parse(text) : undefined;
}

export async function apiGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_HOST}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    throw new Error(`GET ${path} failed with status ${res.status}`);
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
    throw new Error(`${method} ${path} failed with status ${res.status}`);
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

export async function nextApiGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
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
