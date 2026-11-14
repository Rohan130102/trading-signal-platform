import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { act, admin, Client, ctx, LiveClient, newSubscriber, publish, type CreatedSubscriber } from './helpers.js';

interface Route {
  method: string;
  path: string;
  access: string;
}

async function routes(): Promise<Route[]> {
  const doc = (await (await fetch(`${ctx().api}/openapi.json`)).json()) as {
    paths: Record<string, Record<string, { 'x-access': string }>>;
  };
  const out: Route[] = [];
  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      out.push({
        method: method.toUpperCase(),
        path: path.replace('/api/v1', '').replace(/\{[a-zA-Z]+\}/g, randomUUID()),
        access: op['x-access'],
      });
    }
  }
  return out;
}

/** Walks the live route table, so a new route is covered without anyone remembering to add a test. */
describe('every route enforces its access level', () => {
  let all: Route[];
  let subscriber: CreatedSubscriber;
  let expired: CreatedSubscriber;

  beforeAll(async () => {
    all = await routes();
    subscriber = await newSubscriber(30);
    expired = await newSubscriber(30);
    await admin().post(`/admin/subscribers/${expired.id}/adjust`, {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      activationDate: '2026-01-01',
      note: 'test expiry',
      idempotencyKey: randomUUID(),
    });
  });

  it('the route table is substantial and has no accidental public write routes', () => {
    expect(all.length).toBeGreaterThan(50);
    const publicWrites = all.filter((r) => r.access === 'public' && r.method !== 'GET');
    // Signing in, and the sign-up and recovery steps a person takes before they have an account or session.
    expect(publicWrites.map((r) => r.path).sort()).toEqual(
      [
        '/auth/login',
        '/auth/token',
        '/auth/register',
        '/auth/register/resend',
        '/auth/register/verify',
        '/auth/register/complete',
        '/auth/register/complete-token',
        '/auth/password-reset',
        '/auth/password-reset/resend',
        '/auth/password-reset/verify',
      ].sort(),
    );
  });

  it('anonymous visitors get 401 on everything private', async () => {
    const anon = new Client();
    const failures: string[] = [];
    for (const r of all.filter((x) => x.access !== 'public')) {
      const res = await anon.req(r.method, r.path, r.method === 'GET' ? undefined : {});
      if (res.status !== 401) failures.push(`${r.method} ${r.path} -> ${res.status}`);
    }
    expect(failures).toEqual([]);
  });

  it('a subscriber gets 403 on every admin route', async () => {
    const failures: string[] = [];
    for (const r of all.filter((x) => x.access === 'admin')) {
      const res = await subscriber.client.req(r.method, r.path, r.method === 'GET' ? undefined : {});
      if (res.status !== 403) failures.push(`${r.method} ${r.path} -> ${res.status}`);
    }
    expect(failures).toEqual([]);
  });

  it('an expired subscriber gets 403 on every signal route', async () => {
    const failures: string[] = [];
    for (const r of all.filter((x) => x.access === 'active-subscription')) {
      const res = await expired.client.req(r.method, r.path, r.method === 'GET' ? undefined : {});
      if (res.status !== 403 || res.body.error.code !== 'SUBSCRIPTION_EXPIRED') {
        failures.push(`${r.method} ${r.path} -> ${res.status} ${res.body?.error?.code}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('an expired subscriber can still reach their account, so they can read why and sign out', async () => {
    const me = await expired.client.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.access).toEqual({ allowed: false, reason: 'SUBSCRIPTION_EXPIRED' });
    expect(me.body.subscription.state).toBe('EXPIRED');
  });
});

describe('object-level access', () => {
  it('drafts are invisible to subscribers, even by exact id', async () => {
    const { client } = await newSubscriber(30);
    const draft = await admin().post('/admin/drafts', { direction: 'BUY' });
    expect(draft.status).toBe(201);
    expect((await client.get(`/trades/${draft.body.id}`)).status).toBe(404);
    await admin().req('DELETE', `/admin/drafts/${draft.body.id}`);
  });

  it('subscribers never see position size, fees, money or who acted', async () => {
    const { client } = await newSubscriber(30);
    const trade = await publish();
    const activated = await act(trade, 'ACTIVATE', { actualEntry: trade.entryLow, quantity: '7.7701' });
    const closed = await act(activated.body.trade, 'CLOSE', {
      exitPrice: String(Number(trade.entryLow) + 100),
      basis: 'ADMIN_DECLARED_EXECUTION',
      reason: 'MANUAL',
      fees: '12.3401',
      confirm: true,
    });
    expect(closed.status).toBe(201);
    const adminView = await admin().get(`/admin/trades/${trade.id}`);
    expect(adminView.body.closures[0].quantity).toBe('7.7701');
    expect(adminView.body.closures[0].netPnl).toBe('764.6699');

    for (const wire of [
      JSON.stringify((await client.get(`/trades/${trade.id}`)).body),
      JSON.stringify((await client.get('/feed?limit=20')).body),
      JSON.stringify((await client.get('/trades/history?pageSize=50')).body),
    ]) {
      expect(wire).not.toContain('7.7701');
      expect(wire).not.toContain('764.6699');
      expect(wire).not.toContain('12.3401');
      expect(wire).not.toMatch(/netPnl|grossPnl|actorName|actorId|fees/);
    }
  });

  it('internal events never reach the feed or the timeline', async () => {
    const { client } = await newSubscriber(30);
    const trade = await publish();
    await act(trade, 'ACTIVATE', { actualEntry: trade.entryLow, quantity: '1' });
    const detail = await client.get(`/trades/${trade.id}`);
    expect(detail.body.events.map((e: { type: string }) => e.type)).toEqual(['SIGNAL_PUBLISHED', 'ENTRY_ACTIVATED']);
    const feed = await client.get('/feed?limit=50');
    expect(feed.body.events.map((e: { type: string }) => e.type)).not.toContain('EXECUTION_RECORDED');
  });

  it("one subscriber cannot remove or take over another subscriber's device", async () => {
    const a = await newSubscriber(30);
    const b = await newSubscriber(30);
    const endpoint = `${ctx().pushBase}/ok/${randomUUID()}`;
    const keys = { p256dh: 'BPq0yR7n8mU3v6yQk1Xc2Z4aW9eH5tL0sD7fG2hJ3kM', auth: 'c29tZS1hdXRoLXNlY3JldA' };
    expect((await a.client.post('/push/subscriptions', { endpoint, keys })).status).toBe(201);
    await b.client.req('DELETE', '/push/subscriptions', { endpoint });
    const devices = await a.client.get('/push/devices');
    expect(devices.body.devices).toHaveLength(1);
    expect((await b.client.get('/push/devices')).body.devices).toHaveLength(0);
  });

  it('an admin endpoint for a subscriber refuses to act on an administrator', async () => {
    const res = await admin().post(`/admin/subscribers/${ctx().adminId}/suspend`);
    expect(res.status).toBe(404);
  });

  it('rejects a malformed id cleanly', async () => {
    const res = await admin().get("/admin/trades/1'%20OR%20'1'='1");
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

describe('websocket authorization', () => {
  it('refuses anonymous connections', async () => {
    await expect(LiveClient.connect(null)).rejects.toThrow('HTTP 401');
  });

  it('refuses a valid cookie from another origin', async () => {
    const { client } = await newSubscriber(30);
    await expect(LiveClient.connect(client.cookie, 'https://evil.example')).rejects.toThrow('HTTP 403');
  });

  it('refuses a session with an unfinished step', async () => {
    const { client, loginId, temporaryPassword } = await newSubscriber(30, { complete: false });
    await client.post('/auth/login', { identifier: loginId, password: temporaryPassword });
    await expect(LiveClient.connect(client.cookie)).rejects.toThrow('HTTP 401');
  });
});
