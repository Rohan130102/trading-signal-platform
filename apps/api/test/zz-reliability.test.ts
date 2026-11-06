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
