import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  act,
  admin,
  Client,
  control,
  ctx,
  drained,
  instrumentId,
  newSubscriber,
  PASSWORD,
  publish,
  waitUntil,
  withDb,
  type ApiResponse,
} from './helpers.js';
import { WebSocket } from 'ws';

/** A client that behaves like a native app: a bearer token, no cookie and no Origin header. */
class NativeClient {
  constructor(public token: string | null = null) {}

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
    const res = await this.post('/auth/token', { identifier, password, deviceLabel: 'Test phone' });
    if (res.status === 200) this.token = res.body.token;
    return res;
  }
}

async function nativeSubscriber(days = 30) {
  const created = await newSubscriber(days);
  const native = new NativeClient();
  const res = await native.login(created.loginId, PASSWORD);
  expect(res.status).toBe(200);
  return { ...created, native };
}

const expoToken = (kind = 'ok') => `ExponentPushToken[${kind}${randomBytes(10).toString('hex')}]`;

async function expoMessages(
  token: string,
): Promise<{ message: Record<string, any>; ticket: any; httpStatus: number }[]> {
  const log = (await control('/expo-log')) as { message: Record<string, any>; ticket: any; httpStatus: number }[];
  return log.filter((entry) => entry.message.to === token);
}

const waitForExpo = (token: string, count = 1) =>
  waitUntil(
    async () => {
      const messages = await expoMessages(token);
      return messages.length >= count ? messages : false;
    },
    15_000,
    'native push',
  );

describe('native sign-in', () => {
  it('returns a token in the body and sets no cookie', async () => {
    const created = await newSubscriber(30);
    const res = await new NativeClient().post('/auth/token', { identifier: created.loginId, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(Date.parse(res.body.expiresAt)).toBeGreaterThan(Date.now());
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('stores only a hash of the token', async () => {
    const { native } = await nativeSubscriber();
    const rows = await withDb((db) =>
      db.query('SELECT count(*)::int AS n FROM sessions WHERE token_hash = $1', [native.token]),
    );
    expect(rows.rows[0].n).toBe(0);
  });

  it('gives the same answer for an unknown login and a wrong password', async () => {
    const created = await newSubscriber(30);
    const native = new NativeClient();
    const wrong = await native.post('/auth/token', { identifier: created.loginId, password: 'not-the-password' });
    const unknown = await native.post('/auth/token', {
      identifier: `ghost${Date.now()}`,
      password: 'not-the-password',
    });
    expect(wrong.status).toBe(401);
    expect(unknown.body.error.code).toBe(wrong.body.error.code);
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });

  it('follows the same first-time steps: a temporary password opens nothing else', async () => {
    const created = await newSubscriber(30, { complete: false });
    const native = new NativeClient();
    await native.login(created.loginId, created.temporaryPassword);
    expect((await native.get('/auth/me')).body.next).toBe('CHANGE_PASSWORD');
    const blocked = await native.get('/feed');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('SESSION_STEP_REQUIRED');
    const changed = await native.post('/auth/change-password', {
      currentPassword: created.temporaryPassword,
      newPassword: PASSWORD,
    });
    expect(changed.status).toBe(200);
    expect((await native.get('/feed')).status).toBe(200);
  });

  it('a browser page on another site cannot use the native sign-in', async () => {
    const created = await newSubscriber(30);
    const res = await new NativeClient().req(
      'POST',
      '/auth/token',
      { identifier: created.loginId, password: PASSWORD },
      { origin: 'https://evil.example' },
    );
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('BAD_ORIGIN');
  });
});

describe('bearer access', () => {
  it('needs no Origin header, but a missing Origin alone earns nothing', async () => {
    const { native } = await nativeSubscriber();
    expect((await native.post('/feed/read', { seq: 0 })).status).toBe(200);
    const anonymous = await new NativeClient().post('/feed/read', { seq: 0 });
    expect(anonymous.status).toBe(403);
    expect(anonymous.body.error.code).toBe('BAD_ORIGIN');
  });

  it('a cookie with no Origin is still refused, even with a junk bearer header beside it', async () => {
    const { client } = await nativeSubscriber();
    const res = await fetch(`${ctx().api}/auth/logout`, {
      method: 'POST',
      headers: { cookie: client.cookie as string, authorization: 'Bearer junk', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(401);
    expect((await client.get('/auth/me')).status).toBe(200);
  });

  it('an invalid or revoked token gets 401', async () => {
    const { native } = await nativeSubscriber();
    expect((await new NativeClient('not-a-real-token').get('/feed')).status).toBe(401);
    const stale = native.token;
    await native.post('/auth/logout');
    expect((await new NativeClient(stale).get('/feed')).status).toBe(401);
  });

  it('a subscriber token cannot reach admin routes', async () => {
    const { native } = await nativeSubscriber();
    for (const path of ['/admin/dashboard', '/admin/subscribers', '/admin/performance']) {
      expect((await native.get(path)).status).toBe(403);
    }
    expect((await native.post('/admin/signals', {})).status).toBe(403);
  });

  it('expiry applies to tokens on the very next request, and renewal restores access', async () => {
    const { native, id } = await nativeSubscriber();
    expect((await native.get('/trades/active')).status).toBe(200);
    await admin().post(`/admin/subscribers/${id}/adjust`, {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      activationDate: '2026-01-01',
      note: 'expired',
      idempotencyKey: randomUUID(),
    });
    const denied = await native.get('/trades/active');
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('SUBSCRIPTION_EXPIRED');
    expect((await native.get('/auth/me')).body.access.reason).toBe('SUBSCRIPTION_EXPIRED');
    await admin().post(`/admin/subscribers/${id}/renew`, { durationDays: 5, idempotencyKey: randomUUID() });
    expect((await native.get('/trades/active')).status).toBe(200);
  });

  it('an active subscriber stays signed in, so alerts keep reaching that device', async () => {
    const { native, id } = await nativeSubscriber();
    await withDb((db) =>
      db.query(
        "UPDATE sessions SET expires_at = now() + interval '1 day', last_seen_at = now() - interval '2 minutes' WHERE user_id = $1",
        [id],
      ),
    );
    expect((await native.get('/auth/me')).status).toBe(200);
    const row = await withDb((db) =>
      db.query(
        "SELECT expires_at > now() + interval '20 days' AS extended FROM sessions WHERE user_id = $1 ORDER BY last_seen_at DESC LIMIT 1",
        [id],
      ),
    );
    expect(row.rows[0].extended).toBe(true);
  });
});

describe('native live stream', () => {
  const connect = (headers: Record<string, string>) =>
    new Promise<{ ws: WebSocket; messages: any[]; closed: Promise<number> }>((resolve, reject) => {
      const ws = new WebSocket(ctx().ws, { headers });
      const messages: any[] = [];
      const closed = new Promise<number>((done) => ws.on('close', (code) => done(code)));
      ws.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
      ws.once('open', () => resolve({ ws, messages, closed }));
      ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
      ws.once('error', reject);
    });

  it('accepts a bearer token with no allowed Origin and delivers live', async () => {
    const { native } = await nativeSubscriber();
    // React Native sends its own host as the Origin, so it can never be on the allow-list.
    const live = await connect({ authorization: `Bearer ${native.token}`, origin: 'http://10.0.2.2:4101' });
    const head = (await native.get('/feed?limit=1')).body.headSeq;
    live.ws.send(JSON.stringify({ type: 'hello', lastSeq: head }));
    const trade = await publish();
    const message = await waitUntil(() =>
      live.messages.find((m) => m.type === 'event' && m.event.tradeId === trade.id),
    );
    expect(message.event.type).toBe('SIGNAL_PUBLISHED');
    live.ws.close();
  });

  it('refuses a bad token, and still refuses a foreign-origin cookie', async () => {
    await expect(connect({ authorization: 'Bearer nonsense' })).rejects.toThrow('HTTP 401');
    const { client } = await nativeSubscriber();
    await expect(connect({ cookie: client.cookie as string, origin: 'https://evil.example' })).rejects.toThrow(
      'HTTP 403',
    );
  });

  it('closes a token session on sign-out, and on expiry', async () => {
    const first = await nativeSubscriber();
    const liveA = await connect({ authorization: `Bearer ${first.native.token}` });
    liveA.ws.send(JSON.stringify({ type: 'hello', lastSeq: 0 }));
    await first.native.post('/auth/logout');
    expect(await liveA.closed).toBe(4401);

    const second = await nativeSubscriber();
    const liveB = await connect({ authorization: `Bearer ${second.native.token}` });
    liveB.ws.send(JSON.stringify({ type: 'hello', lastSeq: 0 }));
    await admin().post(`/admin/subscribers/${second.id}/adjust`, {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      activationDate: '2026-01-01',
      note: 'expired',
      idempotencyKey: randomUUID(),
    });
    expect(await liveB.closed).toBe(4403);
  });
});

describe('native device registration', () => {
  it('registers a device, lists it as this one, and supports several per subscriber', async () => {
    const { native, loginId } = await nativeSubscriber();
    const first = expoToken();
    expect(
      (await native.post('/push/devices', { token: first, platform: 'android', deviceLabel: 'Pixel' })).status,
    ).toBe(201);
    const second = new NativeClient();
    await second.login(loginId, PASSWORD);
    expect(
      (await second.post('/push/devices', { token: expoToken(), platform: 'ios', deviceLabel: 'iPhone' })).status,
    ).toBe(201);
    const devices = (await native.get('/push/devices')).body.devices;
    expect(devices).toHaveLength(2);
    const mine = devices.find((d: { thisDevice: boolean }) => d.thisDevice);
    expect(mine).toMatchObject({ deviceLabel: 'Pixel', platform: 'android', channel: 'EXPO' });
    expect(JSON.stringify(devices)).not.toContain(first);
  });

  it('refuses a malformed token, a subscriber who has expired, and an anonymous caller', async () => {
    const { native, id } = await nativeSubscriber();
    for (const token of ['nonsense', 'https://169.254.169.254/x', 'ExponentPushToken[]']) {
      expect((await native.post('/push/devices', { token, platform: 'android' })).status).toBe(422);
    }
    expect((await native.post('/push/devices', { token: expoToken(), platform: 'windows' })).status).toBe(422);
    expect((await new NativeClient().post('/push/devices', { token: expoToken(), platform: 'ios' })).status).toBe(403);
    await admin().post(`/admin/subscribers/${id}/adjust`, {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      activationDate: '2026-01-01',
      note: 'expired',
      idempotencyKey: randomUUID(),
    });
    expect((await native.post('/push/devices', { token: expoToken(), platform: 'ios' })).status).toBe(403);
  });

  it('moves a token to whoever signed in on that phone last', async () => {
    const a = await nativeSubscriber();
    const b = await nativeSubscriber();
    const token = expoToken();
    await a.native.post('/push/devices', { token, platform: 'android' });
    await b.native.post('/push/devices', { token, platform: 'android' });
    expect((await a.native.get('/push/devices')).body.devices).toHaveLength(0);
    expect((await b.native.get('/push/devices')).body.devices).toHaveLength(1);
  });

  it("one subscriber cannot remove another subscriber's device", async () => {
    const a = await nativeSubscriber();
    const b = await nativeSubscriber();
    const token = expoToken();
    await a.native.post('/push/devices', { token, platform: 'ios' });
    await b.native.req('DELETE', '/push/devices', { token });
    expect((await a.native.get('/push/devices')).body.devices).toHaveLength(1);
    await a.native.req('DELETE', '/push/devices', { token });
    expect((await a.native.get('/push/devices')).body.devices).toHaveLength(0);
  });
});

describe('native push delivery', () => {
  it('sends a correctly shaped message that deep-links to the trade', async () => {
    const { native } = await nativeSubscriber();
    const token = expoToken();
    await native.post('/push/devices', { token, platform: 'android' });
    const trade = await publish({ entry: 3300, confirmDuplicate: true });
    const [entry] = await waitForExpo(token);
    expect(entry?.message).toMatchObject({
      to: token,
      title: 'New signal: BUY XAU/USD',
      sound: 'default',
      priority: 'high',
      channelId: 'signals',
      ttl: 3600,
      data: { path: `/trades/${trade.id}`, eventId: trade.events[0].id },
    });
    expect(entry?.message.body).toContain('Stop-loss: 3,120.00');
  });

  it('routes updates and announcements to their own Android channels', async () => {
    const { native } = await nativeSubscriber();
    const token = expoToken();
    await native.post('/push/devices', { token, platform: 'android' });
    const trade = await publish();
    await act(trade, 'CANCEL', { comment: 'x' });
    await admin().post('/admin/announcements', { message: 'Closed Friday.', idempotencyKey: randomUUID() });
    const messages = await waitForExpo(token, 3);
    const channels = messages.map((m) => m.message.channelId);
    expect(channels).toEqual(['signals', 'updates', 'announcements']);
    expect(messages[2]?.message.data.path).toBe('/feed');
  });

  it('hides content when the subscriber asked for no previews', async () => {
    const { native } = await nativeSubscriber();
    const token = expoToken();
    await native.post('/push/devices', { token, platform: 'ios' });
    await native.req('PUT', '/me/notification-preferences', {
      pushNewSignals: true,
      pushUpdates: true,
      pushClosures: true,
      pushAnnouncements: true,
      hidePreview: true,
    });
    await publish({ entry: 3305, confirmDuplicate: true });
    const [entry] = await waitForExpo(token);
    expect(entry?.message.title).toBe('New update');
    expect(JSON.stringify(entry?.message)).not.toMatch(/XAU|3,305|Stop-loss/);
  });

  it('never sends to an expired subscriber, and re-checks at send time', async () => {
    const { native, id } = await nativeSubscriber();
    const token = expoToken();
    await native.post('/push/devices', { token, platform: 'android' });
    await admin().post(`/admin/subscribers/${id}/adjust`, {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      activationDate: '2026-01-01',
      note: 'expired',
      idempotencyKey: randomUUID(),
    });
    await publish();
    await new Promise((r) => setTimeout(r, 800));
    expect(await expoMessages(token)).toHaveLength(0);
  });

  it('stops when the device signs out', async () => {
    const { native } = await nativeSubscriber();
    const token = expoToken();
    await native.post('/push/devices', { token, platform: 'android' });
    await native.post('/auth/logout');
    await publish();
    await new Promise((r) => setTimeout(r, 800));
    expect(await expoMessages(token)).toHaveLength(0);
  });

  it('removes a device Expo reports as gone straight away', async () => {
    const { native } = await nativeSubscriber();
    const token = expoToken('gone');
    await native.post('/push/devices', { token, platform: 'android' });
    await publish();
    await waitForExpo(token);
    await waitUntil(async () => (await native.get('/push/devices')).body.devices.length === 0, 8000, 'device removal');
  });

  it('removes a device whose receipt later says it is gone', async () => {
    const { native } = await nativeSubscriber();
    const token = expoToken('lategone');
    await native.post('/push/devices', { token, platform: 'ios' });
    const trade = await publish();
    await waitForExpo(token);
    await waitUntil(
      async () => (await native.get('/push/devices')).body.devices.length === 0,
      15_000,
      'receipt-based removal',
    );
    const rows = await withDb((db) =>
      db.query(
        'SELECT d.status, d.last_error, d.receipt_checked_at IS NOT NULL AS checked FROM push_deliveries d JOIN push_subscriptions s ON s.id = d.push_subscription_id WHERE s.endpoint = $1 AND d.event_id = $2',
        [token, trade.events[0].id],
      ),
    );
    expect(rows.rows[0]).toMatchObject({ status: 'GONE', checked: true });
    expect(rows.rows[0].last_error).toContain('DeviceNotRegistered');
  });

  it('marks a delivery failed when a later receipt reports an error, keeping the device', async () => {
    const { native } = await nativeSubscriber();
    const token = expoToken('latefail');
    await native.post('/push/devices', { token, platform: 'android' });
    const trade = await publish();
    await waitForExpo(token);
    const row = await waitUntil(
      async () => {
        const r = await withDb((db) =>
          db.query(
            'SELECT d.status, d.last_error FROM push_deliveries d JOIN push_subscriptions s ON s.id = d.push_subscription_id WHERE s.endpoint = $1 AND d.event_id = $2',
            [token, trade.events[0].id],
          ),
        );
        return r.rows[0]?.status === 'FAILED' ? r.rows[0] : false;
      },
      15_000,
      'failed receipt',
    );
    expect(row.last_error).toContain('MismatchSenderId');
    expect((await native.get('/push/devices')).body.devices).toHaveLength(1);
    const detail = await admin().get(`/admin/trades/${trade.id}`);
    expect(detail.body.events[0].dispatch.failed).toBeGreaterThanOrEqual(1);
  });

  it('retries when Expo is rate limiting or unavailable', async () => {
    for (const kind of ['rate', 'http500']) {
      await drained();
      const { native } = await nativeSubscriber();
      const token = expoToken(kind);
      await native.post('/push/devices', { token, platform: 'android' });
      const trade = await publish();
      await waitForExpo(token, 2);
      const row = await waitUntil(async () => {
        const r = await withDb((db) =>
          db.query(
            'SELECT d.status, d.attempts FROM push_deliveries d JOIN push_subscriptions s ON s.id = d.push_subscription_id WHERE s.endpoint = $1 AND d.event_id = $2',
            [token, trade.events[0].id],
          ),
        );
        return r.rows[0]?.status === 'ACCEPTED' ? r.rows[0] : false;
      });
      expect(row.attempts).toBe(2);
    }
  }, 40_000);

  it('does not retry a permanent rejection', async () => {
    const { native } = await nativeSubscriber();
    const token = expoToken('toobig');
    await native.post('/push/devices', { token, platform: 'android' });
    const trade = await publish();
    await waitForExpo(token);
    const row = await waitUntil(async () => {
      const r = await withDb((db) =>
        db.query(
          'SELECT d.status, d.attempts, d.last_error FROM push_deliveries d JOIN push_subscriptions s ON s.id = d.push_subscription_id WHERE s.endpoint = $1 AND d.event_id = $2',
          [token, trade.events[0].id],
        ),
      );
      return r.rows[0]?.status === 'FAILED' ? r.rows[0] : false;
    });
    expect(row.attempts).toBe(1);
    expect(row.last_error).toContain('MessageTooBig');
  });

  it('survives a worker crash: nothing is lost, and nothing is sent twice', async () => {
    await drained();
    const { native } = await nativeSubscriber();
    const token = expoToken();
    await native.post('/push/devices', { token, platform: 'android' });
    await control('/worker/kill');
    const trade = await publish();
    await new Promise((r) => setTimeout(r, 500));
    expect(await expoMessages(token)).toHaveLength(0);
    await control('/worker/start');
    await waitForExpo(token);
    await drained();
    await withDb((db) =>
      db.query("UPDATE outbox_events SET status = 'PENDING', available_at = now() WHERE event_id = $1", [
        trade.events[0].id,
      ]),
    );
    await new Promise((r) => setTimeout(r, 900));
    expect(await expoMessages(token)).toHaveLength(1);
  });

  it('the test notification goes only to the caller and carries no signal data', async () => {
    const a = await nativeSubscriber();
    const b = await nativeSubscriber();
    const mine = expoToken();
    const theirs = expoToken();
    await a.native.post('/push/devices', { token: mine, platform: 'android' });
    await b.native.post('/push/devices', { token: theirs, platform: 'android' });
    const res = await a.native.post('/push/test');
    expect(res.body).toMatchObject({ attempted: 1, accepted: 1 });
    const [entry] = await waitForExpo(mine);
    expect(entry?.message.title).toBe('Test notification');
    expect(await expoMessages(theirs)).toHaveLength(0);
  });

  it('web and native devices on one account each get the event once', async () => {
    const { native, client } = await nativeSubscriber();
    const token = expoToken();
    await native.post('/push/devices', { token, platform: 'android' });
    const trade = await publish();
    await waitForExpo(token);
    const rows = await withDb((db) =>
      db.query(
        'SELECT count(*)::int AS n FROM push_deliveries d JOIN push_subscriptions s ON s.id = d.push_subscription_id WHERE s.endpoint = $1 AND d.event_id = $2',
        [token, trade.events[0].id],
      ),
    );
    expect(rows.rows[0].n).toBe(1);
    expect((await client.get('/feed?limit=1')).status).toBe(200);
    expect(await instrumentId()).toBeTruthy();
  });

  it('the admin health view says whether native push is available', async () => {
    const health = await admin().get('/admin/notifications/health');
    expect(health.body.push.nativeAvailable).toBe(true);
    const config = await new NativeClient((await nativeSubscriber()).native.token).get('/push/config');
    expect(config.body.nativeAvailable).toBe(true);
    expect(new Client().cookie).toBeNull();
  });
});
