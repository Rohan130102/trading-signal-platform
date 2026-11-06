import { API } from './config';

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

const TIMEOUT_MS = 20_000;

let token: string | null = null;
let onSessionEnded: (() => void) | null = null;

export function setApiToken(value: string | null): void {
  token = value;
}

export function getApiToken(): string | null {
  return token;
}

/** Runs when the server says this session is over, wherever in the app that was noticed. */
export function setSessionEndedHandler(handler: (() => void) | null): void {
  onSessionEnded = handler;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!API.origin) throw new ApiError(0, 'NOT_CONFIGURED', API.problem ?? 'No server address is set.');
  const sentWith = token;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API.origin}/api/v1${path}`, {
      method,
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(sentWith ? { authorization: `Bearer ${sentWith}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Could not reach the server. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
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
    // A wrong password also answers 401, so only a session we actually sent counts as ended.
    if (response.status === 401 && sentWith && sentWith === token) onSessionEnded?.();
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
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '' && value !== false) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.length ? `?${parts.join('&')}` : '';
}
