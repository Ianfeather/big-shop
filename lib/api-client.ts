// Fetch helpers backing every hooks/use-*.ts query and useMutation call
// site - see follow-ups.md #20. Two families:
//  - apiGet/apiPost/apiPut/apiPatch/apiDelete: the Go API (NEXT_PUBLIC_API_HOST),
//    bearer-token authenticated.
//  - localApiGet/localApiPost/localApiPostFormData: same-origin Next.js API
//    routes (pages/api/*), unauthenticated (those routes don't check a
//    token) and error-shaped as `{ error: string }` on failure.

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

async function handleLocalResponse<T>(res: Response, label: string): Promise<T> {
  const data = await parseBody(res);
  if (!res.ok) {
    throw new Error((data as { error?: string } | undefined)?.error ?? `${label} failed with status ${res.status}`);
  }
  return data as T;
}

export async function localApiGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
  return handleLocalResponse<T>(res, `GET ${url}`);
}

export async function localApiPost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return handleLocalResponse<T>(res, `POST ${url}`);
}

export async function localApiPostFormData<T>(url: string, formData: FormData): Promise<T> {
  const res = await fetch(url, { method: 'POST', body: formData });
  return handleLocalResponse<T>(res, `POST ${url}`);
}
