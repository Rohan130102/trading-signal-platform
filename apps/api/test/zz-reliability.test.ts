import { describe, expect, it } from 'vitest';
import { admin, control, ctx, headSeq, LiveClient, newSubscriber, publish, signalBody, waitUntil } from './helpers.js';

/** Named to run last: it stops the database everyone else is using. */
describe('rate limiting', () => {
  it('turns away a flood from one client and keeps health checks reachable', async () => {
    const base = ctx().limitedApi;
    const statuses = await Promise.all(
      Array.from({ length: 40 }, () => fetch(`${base}/public/info`).then((r) => r.status)),
    );
    expect(statuses).toContain(429);
    const limited = await fetch(`${base}/public/info`);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
    expect((await fetch(`${base.replace('/api/v1', '')}/health/live`)).status).toBe(200);
  });

  // The limited API allows 20 requests a minute. Each test uses its own made-up public address.
  const from = (address: string, path: string, headers: Record<string, string> = {}) =>
    fetch(`${ctx().limitedApi}${path}`, { headers: { 'x-forwarded-for': address, ...headers } }).then((r) => r.status);

  const sessionCookie = async () => {
    const { client } = await newSubscriber(30);
    return { cookie: client.cookie as string };
  };

  it("does not let subscribers behind one shared address use up each other's allowance", async () => {
    const address = '203.0.113.10';
    const sessions = await Promise.all([sessionCookie(), sessionCookie(), sessionCookie()]);
    const statuses: number[] = [];
    for (let round = 0; round < 15; round += 1) {
      statuses.push(...(await Promise.all(sessions.map((headers) => from(address, '/auth/me', headers)))));
    }
    expect(statuses).toHaveLength(45);
    expect(statuses.every((status) => status === 200)).toBe(true);
  }, 60_000);

  it('still limits one busy session, without blocking others on the same address', async () => {
    const address = '203.0.113.11';
    const busy = await sessionCookie();
    const quiet = await sessionCookie();
    expect(await from(address, '/auth/me', quiet)).toBe(200);
    const statuses: number[] = [];
    for (let i = 0; i < 30; i += 1) statuses.push(await from(address, '/auth/me', busy));
    expect(statuses).toContain(429);
    expect(await from(address, '/auth/me', quiet)).toBe(200);
  }, 60_000);

  it('gives made-up credentials no allowance of their own', async () => {
    const address = '203.0.113.12';
    const real = await sessionCookie();
    expect(await from(address, '/auth/me', real)).toBe(200);
    const statuses: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      statuses.push(await from(address, '/public/info', { authorization: `Bearer made-up-${i}` }));
    }
    expect(statuses).toContain(429);
    expect(await from(address, '/public/info')).toBe(429);
    expect(await from(address, '/auth/me', real)).toBe(200);
  }, 60_000);

  it('takes the separate allowance away once a session has ended', async () => {
    const address = '203.0.113.13';
    const ended = await sessionCookie();
    expect(await from(address, '/auth/me', ended)).toBe(200);
    const signedOut = await fetch(`${ctx().limitedApi}/auth/logout`, {
      method: 'POST',
      headers: { 'x-forwarded-for': address, origin: ctx().origin, ...ended },
    });
    expect(signedOut.ok).toBe(true);
    const statuses: number[] = [];
    for (let i = 0; i < 25; i += 1) statuses.push(await from(address, '/auth/me', ended));
    expect(statuses[0]).toBe(401);
    expect(statuses).toContain(429);
  }, 60_000);
});

describe('database outage', () => {
  it('fails safely, reports not-ready, then recovers with no lost events', async () => {
    const { client } = await newSubscriber(30);
    const live = await LiveClient.connect(client.cookie);
    const from = await headSeq(client);
    live.hello(from);
    const before = await publish();
    await live.waitForEvent((e) => e.tradeId === before.id);

    const body = await signalBody();
    const lateJoiner = await LiveClient.connect(client.cookie);
    await control('/pg/stop');

    // Asking for catch-up with the database gone must not take the API down.
    lateJoiner.hello(from);
    await new Promise((r) => setTimeout(r, 400));
    expect((await fetch(`${ctx().api.replace('/api/v1', '')}/health/live`)).status).toBe(200);

    const base = ctx().api.replace('/api/v1', '');
    const ready = await fetch(`${base}/health/ready`);
    expect(ready.status).toBe(503);
    expect((await fetch(`${base}/health/live`)).status).toBe(200);

    const failed = await admin().post('/admin/signals', body);
    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(JSON.stringify(failed.body)).not.toMatch(/ECONNREFUSED|localhost|password|prisma/i);

    await control('/pg/start');
    await waitUntil(async () => (await fetch(`${base}/health/ready`)).ok, 20_000, 'database recovery');

    // The same request, retried with the same key, publishes exactly once.
    const retried = await waitUntil(
      async () => {
        const r = await admin().post('/admin/signals', body);
        return r.status === 201 ? r : false;
      },
      20_000,
      'publish after recovery',
    );
    expect(retried.body.trade.status).toBe('PUBLISHED');

    // The listener reconnects, or the poll catches up: either way the socket gets it.
    await live.waitForEvent((e) => e.tradeId === retried.body.trade.id, 15_000);
    const seqs = live.events.map((e) => e.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    live.close();

    // The connection that failed its catch-up during the outage gets everything afterwards.
    await lateJoiner.waitForEvent((e) => e.tradeId === before.id, 15_000);
    await lateJoiner.waitForEvent((e) => e.tradeId === retried.body.trade.id, 15_000);
    lateJoiner.close();
  }, 90_000);
});
