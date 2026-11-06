export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: {
      issues?: { field: string; code: string; message: string }[];
      next?: string;
      tradeId?: string;
      ref?: string;
    },
  ) {
    super(message);
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }
}

const BASE = '/api/v1';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Could not reach the server. Check your connection and try again.');
  }
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Handled below: a proxy error page is not JSON.
  }
  if (!response.ok) {
    const error = (parsed as { error?: { code?: string; message?: string; details?: ApiError['details'] } } | null)
      ?.error;
    if (!error && response.status >= 500) {
      throw new ApiError(
        response.status,
        'SERVER_UNAVAILABLE',
        'The server is unavailable right now. Please try again shortly.',
      );
    }
    throw new ApiError(
      response.status,
      error?.code ?? 'ERROR',
      error?.message ?? 'Something went wrong.',
      error?.details,
    );
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};

export function queryString(params: Record<string, string | number | undefined | null | false>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '' && value !== false) search.set(key, String(value));
  }
  const out = search.toString();
  return out ? `?${out}` : '';
}
