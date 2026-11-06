import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { admin, Client, headSeq, LiveClient, newSubscriber, PASSWORD, publish, uniqueId, withDb } from './helpers.js';

const expireNow = (id: string) =>
  admin().post(`/admin/subscribers/${id}/adjust`, {
    expiresAt: new Date(Date.now() - 1000).toISOString(),
    activationDate: '2026-01-01',
    note: 'Test: end access',
    idempotencyKey: randomUUID(),
  });

describe('creating subscribers', () => {
  it('assigns credentials once, with a temporary password that is shown only in this response', async () => {
    const loginId = uniqueId();
    const created = await admin().post('/admin/subscribers', {
      name: 'Asha',
      loginId,
      phone: '+91 98765 43210',
      durationDays: 30,
      idempotencyKey: randomUUID(),
    });
    expect(created.status).toBe(201);
    expect(created.body.temporaryPassword).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect(created.body.subscriber.subscription.state).toBe('ACTIVE');
    const detail = await admin().get(`/admin/subscribers/${created.body.subscriber.id}`);
    expect(JSON.stringify(detail.body)).not.toContain(created.body.temporaryPassword);
  });

  it('a repeated request does not create a second account or reveal the password again', async () => {
    const key = randomUUID();
    const body = { name: 'Dup', loginId: uniqueId(), durationDays: 10, idempotencyKey: key };
    const [a, b] = await Promise.all([
      admin().post('/admin/subscribers', body),
      admin().post('/admin/subscribers', body),
    ]);
    expect(a?.status).toBe(201);
    expect(b?.status).toBe(201);
    expect(a?.body.subscriber.id).toBe(b?.body.subscriber.id);
    expect([a?.body.temporaryPassword, b?.body.temporaryPassword].filter(Boolean)).toHaveLength(1);
  });

  it('refuses a login ID already in use, whatever the case', async () => {
    const loginId = uniqueId();
    await admin().post('/admin/subscribers', { name: 'One', loginId, durationDays: 1, idempotencyKey: randomUUID() });
    const taken = await admin().post('/admin/subscribers', {
      name: 'Two',
      loginId: loginId.toUpperCase(),
      durationDays: 1,
      idempotencyKey: randomUUID(),
    });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('LOGIN_ID_TAKEN');
  });

  it('login is case-insensitive', async () => {
    const { loginId } = await newSubscriber(5);
    expect(
      (await new Client().post('/auth/login', { identifier: loginId.toUpperCase(), password: PASSWORD })).status,
    ).toBe(200);
  });

  it('a future activation date stays locked until then, and a past one is refused', async () => {
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const created = await admin().post('/admin/subscribers', {
      name: 'Later',
      loginId: uniqueId(),
      durationDays: 5,
      activationDate: future,
      idempotencyKey: randomUUID(),
    });
    expect(created.body.subscriber.subscription.state).toBe('SCHEDULED');
    const client = new Client();
    await client.post('/auth/login', {
      identifier: created.body.subscriber.loginId,
      password: created.body.temporaryPassword,
    });
    await client.post('/auth/change-password', {
      currentPassword: created.body.temporaryPassword,
      newPassword: PASSWORD,
    });
    const blocked = await client.get('/feed');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('SUBSCRIPTION_SCHEDULED');
    const past = await admin().post('/admin/subscribers', {
      name: 'Past',
      loginId: uniqueId(),
      durationDays: 5,
      activationDate: '2020-01-01',
      idempotencyKey: randomUUID(),
    });
    expect(past.body.error.code).toBe('ACTIVATION_IN_PAST');
  });

  it('searches and filters', async () => {
    const loginId = uniqueId('findme');
    await admin().post('/admin/subscribers', {
      name: 'Findable Person',
      loginId,
      email: 'findable@example.test',
      durationDays: 3,
      idempotencyKey: randomUUID(),
    });
    const byName = await admin().get('/admin/subscribers?q=findable');
    expect(byName.body.subscribers[0].loginId).toBe(loginId);
    const expiring = await admin().get('/admin/subscribers?access=EXPIRING&q=findable');
    expect(expiring.body.total).toBe(1);
    const expired = await admin().get('/admin/subscribers?access=EXPIRED&q=findable');
    expect(expired.body.total).toBe(0);
  });
});

describe('expiry', () => {
  it('protected access ends the moment the subscription does, and renewal restores it', async () => {
    const { client, id } = await newSubscriber(30);
    const trade = await publish();
    expect((await client.get('/feed')).status).toBe(200);
    expect((await client.get(`/trades/${trade.id}`)).status).toBe(200);

    await expireNow(id);
    for (const path of ['/feed', '/trades/active', '/trades/history', `/trades/${trade.id}`, '/instruments/symbols']) {
      const res = await client.get(path);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('SUBSCRIPTION_EXPIRED');
      expect(JSON.stringify(res.body)).not.toContain(trade.ref);
    }
    const renewed = await admin().post(`/admin/subscribers/${id}/renew`, {
      durationDays: 7,
      idempotencyKey: randomUUID(),
    });
    expect(renewed.body.subscriber.subscription.state).toBe('ACTIVE');
    expect(renewed.body.subscriber.events[0].mode).toBe('RESTARTED_FROM_NOW');
    expect((await client.get('/feed')).status).toBe(200);
    expect((await client.get(`/trades/${trade.id}`)).status).toBe(200);
  });

  it('enforces the server clock with an exact end time', async () => {
    const { client, id } = await newSubscriber(30);
    await admin().post(`/admin/subscribers/${id}/adjust`, {
      expiresAt: new Date(Date.now() + 1500).toISOString(),
      note: 'Ends in a moment',
      idempotencyKey: randomUUID(),
    });
    expect((await client.get('/feed')).status).toBe(200);
    await new Promise((r) => setTimeout(r, 1700));
    expect((await client.get('/feed')).status).toBe(403);
  });

  it('renewing an active subscription extends from its expiry, and repeating the request changes nothing', async () => {
    const { id } = await newSubscriber(10);
    const before = (await admin().get(`/admin/subscribers/${id}`)).body.subscription;
    const key = randomUUID();
    const results = await Promise.all([
      admin().post(`/admin/subscribers/${id}/renew`, { durationDays: 30, idempotencyKey: key }),
      admin().post(`/admin/subscribers/${id}/renew`, { durationDays: 30, idempotencyKey: key }),
    ]);
    expect(results.every((r) => r.status === 201)).toBe(true);
    const after = (await admin().get(`/admin/subscribers/${id}`)).body;
    expect(after.subscription.daysRemaining).toBe(before.daysRemaining + 30);
    expect(after.events.filter((e: { type: string }) => e.type === 'RENEWED')).toHaveLength(1);
    expect(after.events[0]).toMatchObject({ mode: 'EXTENDED_FROM_EXPIRY', actorName: 'Root Admin' });
    const rows = await withDb((db) =>
      db.query('SELECT count(*)::int AS n FROM subscriptions WHERE user_id = $1', [id]),
    );
    expect(rows.rows[0].n).toBe(1);
  });

  it('a one-day subscription is valid through the end of the local day', async () => {
    const { id } = await newSubscriber(1);
    const sub = (await admin().get(`/admin/subscribers/${id}`)).body.subscription;
    const todayInIst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    expect(sub.lastValidDate).toBe(todayInIst);
    expect(sub.daysRemaining).toBe(1);
  });

  it('an adjustment needs a reason and valid dates', async () => {
    const { id } = await newSubscriber(5);
    const noReason = await admin().post(`/admin/subscribers/${id}/adjust`, {
      lastValidDate: '2030-01-01',
      idempotencyKey: randomUUID(),
    });
    expect(noReason.status).toBe(422);
    const backwards = await admin().post(`/admin/subscribers/${id}/adjust`, {
      expiresAt: '2001-01-01T00:00:00Z',
      note: 'bad',
      idempotencyKey: randomUUID(),
    });
    expect(backwards.status).toBe(422);
    const both = await admin().post(`/admin/subscribers/${id}/adjust`, {
      lastValidDate: '2030-01-01',
      expiresAt: '2030-01-01T00:00:00Z',
      note: 'both',
      idempotencyKey: randomUUID(),
    });
    expect(both.status).toBe(422);
    const ok = await admin().post(`/admin/subscribers/${id}/adjust`, {
      lastValidDate: '2030-01-01',
      note: 'Goodwill',
      idempotencyKey: randomUUID(),
    });
    expect(ok.body.subscriber.subscription.lastValidDate).toBe('2030-01-01');
  });
});

describe('live connections and access changes', () => {
  it('expiring a subscriber closes their open socket, and new events never reach them', async () => {
    const { client, id } = await newSubscriber(30);
    const live = await LiveClient.connect(client.cookie);
    live.hello(await headSeq(client));
    await expireNow(id);
    const closed = await live.waitForClose();
    expect(closed.code).toBe(4403);
    expect(live.messages.some((m) => m.type === 'denied' && m.reason === 'SUBSCRIPTION_EXPIRED')).toBe(true);
    const trade = await publish();
    await new Promise((r) => setTimeout(r, 400));
    expect(live.events.find((e) => e.tradeId === trade.id)).toBeUndefined();
  });

  it('an exact expiry closes the socket with no administrator action', async () => {
    const { client, id } = await newSubscriber(30);
    const live = await LiveClient.connect(client.cookie);
    live.hello(await headSeq(client));
    await admin().post(`/admin/subscribers/${id}/adjust`, {
      expiresAt: new Date(Date.now() + 1000).toISOString(),
      note: 'short',
      idempotencyKey: randomUUID(),
    });
    await new Promise((r) => setTimeout(r, 1100));
    const trade = await publish();
    const closed = await live.waitForClose(12_000);
    expect(closed.code).toBe(4403);
    expect(live.events.find((e) => e.tradeId === trade.id)).toBeUndefined();
  });

  it('a socket opened after expiry is told why and closed', async () => {
    const { client, id } = await newSubscriber(30);
    await expireNow(id);
    const live = await LiveClient.connect(client.cookie);
    const closed = await live.waitForClose();
    expect(closed.code).toBe(4403);
    expect(live.messages[0]).toMatchObject({ type: 'denied', reason: 'SUBSCRIPTION_EXPIRED' });
  });

  it('suspending an account ends sessions and sockets immediately; reactivation requires signing in again', async () => {
    const { client, id, loginId } = await newSubscriber(30);
    const live = await LiveClient.connect(client.cookie);
    live.hello(await headSeq(client));
    await admin().post(`/admin/subscribers/${id}/suspend`, { note: 'Payment query' });
    const closed = await live.waitForClose();
    expect(closed.code).toBe(4401);
    expect((await client.get('/feed')).status).toBe(401);
    expect((await new Client().post('/auth/login', { identifier: loginId, password: PASSWORD })).status).toBe(401);
    await admin().post(`/admin/subscribers/${id}/reactivate`, {});
    const again = new Client();
    expect((await again.post('/auth/login', { identifier: loginId, password: PASSWORD })).status).toBe(200);
    expect((await again.get('/feed')).status).toBe(200);
  });

  it('revoking sessions closes the socket', async () => {
    const { client, id } = await newSubscriber(30);
    const live = await LiveClient.connect(client.cookie);
    live.hello(await headSeq(client));
    await admin().post(`/admin/subscribers/${id}/revoke-sessions`);
    expect((await live.waitForClose()).code).toBe(4401);
  });

  it("signing out closes that session's socket", async () => {
    const { client } = await newSubscriber(30);
    const live = await LiveClient.connect(client.cookie);
    live.hello(await headSeq(client));
    await client.post('/auth/logout');
    expect((await live.waitForClose()).code).toBe(4401);
  });

  it('renewal does not disturb a subscriber who is already connected', async () => {
    const { client, id } = await newSubscriber(30);
    const live = await LiveClient.connect(client.cookie);
    live.hello(await headSeq(client));
    await admin().post(`/admin/subscribers/${id}/renew`, { durationDays: 30, idempotencyKey: randomUUID() });
    const trade = await publish();
    await live.waitForEvent((e) => e.tradeId === trade.id);
    expect(live.closed).toBeNull();
    live.close();
  });
});
