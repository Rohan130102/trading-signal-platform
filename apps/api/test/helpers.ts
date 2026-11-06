import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import { WebSocket } from 'ws';

export const ctx = () => inject('ctx');

export interface ApiResponse<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

export class Client {
  constructor(
    public cookie: string | null = null,
    private readonly base = ctx().api,
  ) {}

  async req<T = any>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<ApiResponse<T>> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method !== 'GET' ? { origin: ctx().origin } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Keep the raw text.
    }
    const setCookie = res.headers.get('set-cookie');
    if (setCookie?.startsWith('sd_session=') && !setCookie.includes('Expires=Thu, 01 Jan 1970')) {
      this.cookie = setCookie.split(';')[0] as string;
    }
    return { status: res.status, body: parsed as T, headers: res.headers };
  }

  get<T = any>(path: string) {
    return this.req<T>('GET', path);
  }

  post<T = any>(path: string, body: unknown = {}) {
    return this.req<T>('POST', path, body);
  }
}

export const admin = () => new Client(ctx().adminCookie);

export const PASSWORD = 'correct-horse-battery';
let counter = 0;

export function uniqueId(prefix = 'sub'): string {
  counter += 1;
  return `${prefix}.${Date.now().toString(36)}.${counter}`;
}

export interface CreatedSubscriber {
  client: Client;
  id: string;
  loginId: string;
  temporaryPassword: string;
}

/** Creates a subscriber through the real API and takes them through first sign-in. */
export async function newSubscriber(days = 30, { complete = true } = {}): Promise<CreatedSubscriber> {
  const loginId = uniqueId();
  const created = await admin().post('/admin/subscribers', {
    name: 'Test Subscriber',
    loginId,
    durationDays: days,
    idempotencyKey: randomUUID(),
  });
  if (created.status !== 201) throw new Error(`create failed: ${JSON.stringify(created.body)}`);
  const client = new Client();
  const temporaryPassword = created.body.temporaryPassword as string;
  if (complete) {
    await client.post('/auth/login', { identifier: loginId, password: temporaryPassword });
    const changed = await client.post('/auth/change-password', {
      currentPassword: temporaryPassword,
      newPassword: PASSWORD,
    });
    if (changed.status !== 200) throw new Error(`password change failed: ${JSON.stringify(changed.body)}`);
  }
  return { client, id: created.body.subscriber.id, loginId, temporaryPassword };
}

let cachedInstruments: Record<string, { id: string }> | null = null;

export async function instrumentId(symbol = 'XAU/USD'): Promise<string> {
  if (!cachedInstruments) {
    const res = await admin().get('/admin/instruments');
    cachedInstruments = Object.fromEntries(
      res.body.instruments.map((i: { symbol: string; id: string }) => [i.symbol, i]),
    );
  }
  const found = cachedInstruments?.[symbol];
  if (!found) throw new Error(`No instrument ${symbol}`);
  return found.id;
}

let priceCursor = 2000 + Math.floor(Math.random() * 400_000) * 2;

/** Each call gets a fresh entry price across all test files, so tests do not trip the duplicate-signal warning. */
export function nextEntry(): number {
  priceCursor += 11;
  return priceCursor;
}

export async function signalBody(overrides: Record<string, unknown> = {}) {
  const entry = (overrides.entry as number | undefined) ?? nextEntry();
  const { entry: _ignored, ...rest } = overrides;
  return {
    instrumentId: await instrumentId(),
    direction: 'BUY',
    entryType: 'SINGLE',
    entryLow: String(entry),
    entryHigh: String(entry),
    targets: [String(entry + 150)],
    stopLoss: String(entry - 180),
    idempotencyKey: randomUUID(),
    ...rest,
  };
}

export async function publish(overrides: Record<string, unknown> = {}) {
  const res = await admin().post('/admin/signals', await signalBody(overrides));
  if (res.status !== 201) throw new Error(`publish failed: ${JSON.stringify(res.body)}`);
  return res.body.trade;
}

export async function act(
  trade: { id: string; version: number },
  action: string,
  fields: Record<string, unknown> = {},
) {
  return admin().post(`/admin/trades/${trade.id}/events`, {
    action,
    expectedVersion: trade.version,
    idempotencyKey: randomUUID(),
    ...fields,
  });
}

export async function activeTrade(overrides: Record<string, unknown> = {}) {
  const trade = await publish(overrides);
  const res = await act(trade, 'ACTIVATE');
  if (res.status !== 201) throw new Error(`activate failed: ${JSON.stringify(res.body)}`);
  return res.body.trade;
}

export async function withDb<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: ctx().databaseUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function waitUntil<T>(
  check: () => Promise<T | false | null | undefined> | T | false | null | undefined,
  timeoutMs = 10_000,
  label = 'condition',
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

export interface WsMessage {
  type: string;
  event?: { seq: number; id: string; type: string; tradeId: string | null; payload: Record<string, unknown> };
  reason?: string;
  headSeq?: number;
}

export class LiveClient {
  readonly messages: WsMessage[] = [];
  closed: { code: number; reason: string } | null = null;

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => this.messages.push(JSON.parse(data.toString()) as WsMessage));
    ws.on('close', (code, reason) => {
      this.closed = { code, reason: reason.toString() };
    });
    ws.on('error', () => undefined);
  }

  static connect(cookie: string | null, origin = ctx().origin): Promise<LiveClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(ctx().ws, { headers: { origin, ...(cookie ? { cookie } : {}) } });
      const client = new LiveClient(ws);
      ws.once('open', () => resolve(client));
      ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
      ws.once('error', reject);
    });
  }

  hello(lastSeq: number): void {
    this.ws.send(JSON.stringify({ type: 'hello', lastSeq }));
  }

  get events() {
    return this.messages.filter((m) => m.type === 'event').map((m) => m.event as NonNullable<WsMessage['event']>);
  }

  waitForEvent(predicate: (e: NonNullable<WsMessage['event']>) => boolean, timeoutMs = 8000) {
    return waitUntil(() => this.events.find(predicate), timeoutMs, 'live event');
  }

  waitForClose(timeoutMs = 10_000) {
    return waitUntil(() => this.closed, timeoutMs, 'socket close');
  }

  close(): void {
    this.ws.close();
  }
}

export async function headSeq(client: Client): Promise<number> {
  const page = await client.get('/feed?limit=1');
  return page.body.headSeq as number;
}

export async function control(path: string): Promise<any> {
  const res = await fetch(`${ctx().control}${path}`);
  return res.json();
}

/** Waits for background work from earlier tests to finish, so it cannot reach a new device. */
export async function drained(): Promise<void> {
  await waitUntil(
    () =>
      withDb(async (db) => {
        const outbox = await db.query(
          "SELECT count(*)::int AS n FROM outbox_events WHERE status IN ('PENDING', 'PROCESSING')",
        );
        const push = await db.query(
          "SELECT count(*)::int AS n FROM push_deliveries WHERE status IN ('PENDING', 'SENDING')",
        );
        return outbox.rows[0].n === 0 && push.rows[0].n === 0;
      }),
    15_000,
    'background work to finish',
  );
}
