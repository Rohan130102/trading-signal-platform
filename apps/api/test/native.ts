import { randomBytes } from 'node:crypto';
import { ctx, type ApiResponse } from './helpers.js';

/** A new app installation's identifier, as the app derives one: opaque, URL-safe, stable per install. */
export const newInstallationId = () => randomBytes(16).toString('hex');

/**
 * A client that behaves like a native app: a bearer token, no cookie and no Origin header. Each instance
 * is one app installation, so signing in sends the same installation identifier every time.
 */
export class NativeClient {
  constructor(
    public token: string | null = null,
    public installationId: string = newInstallationId(),
  ) {}

  async req<T = any>(
    method: string,
    path: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ): Promise<ApiResponse<T>> {
    const res = await fetch(`${ctx().api}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T, headers: res.headers };
  }

  get<T = any>(path: string) {
    return this.req<T>('GET', path);
  }

  post<T = any>(path: string, body: unknown = {}) {
    return this.req<T>('POST', path, body);
  }

  async login(identifier: string, password: string) {
    const res = await this.post('/auth/token', {
      identifier,
      password,
      deviceLabel: 'Test phone',
      installationId: this.installationId,
      platform: 'android',
    });
    if (res.status === 200) this.token = res.body.token;
    return res;
  }
}
