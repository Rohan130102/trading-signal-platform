import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { act, activeTrade, admin, type Client, headSeq, LiveClient, newSubscriber, publish } from './helpers.js';

/*
 * One rule for every subscriber screen: what was published while the member was entitled. Trades and announcements
 * alike, in lists, details, alerts, counts, the live stream and pushes. Service notices are open to everyone.
 */

const DAY = 86_400_000;

async function announce(category = 'GENERAL', title = `Notice ${randomUUID().slice(0, 8)}`) {
  const res = await admin().post('/admin/announcements', {
    title,
    body: 'Body text.',
    category,
    idempotencyKey: randomUUID(),
  });
  expect(res.status).toBe(201);
  return res.body as { id: string; title: string };
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
const board = async (client: Client) => ids((await client.get('/announcements')).body.announcements);
const history = async (client: Client) => ids((await client.get('/trades/history?pageSize=100')).body.trades);
const cards = async (client: Client) => ids((await client.get('/signals?status=ALL&limit=50')).body.cards);
const alerts = async (client: Client) => (await client.get('/notifications?limit=50')).body;

describe('what a new subscriber sees', () => {
  it('trades and announcements from before they joined stay out; later ones show', async () => {
    const tradeA = await activeTrade();
    const announcementA = await announce();
    const sub = await newSubscriber(30);
    const tradeB = await publish();
    const announcementB = await announce();

    expect(await history(sub.client)).toContain(tradeB.id);
    expect(await history(sub.client)).not.toContain(tradeA.id);
    expect(await cards(sub.client)).toContain(tradeB.id);
    expect(await cards(sub.client)).not.toContain(tradeA.id);
    expect(await board(sub.client)).toContain(announcementB.id);
    expect(await board(sub.client)).not.toContain(announcementA.id);

    // Typing an old identifier reveals nothing.
    expect((await sub.client.get(`/trades/${tradeA.id}`)).status).toBe(404);
    expect((await sub.client.get(`/trades/${tradeB.id}`)).status).toBe(200);
    expect((await sub.client.post('/me/hidden', { type: 'TRADE', id: tradeA.id })).status).toBe(404);
    expect((await sub.client.post('/me/hidden', { type: 'ANNOUNCEMENT', id: announcementA.id })).status).toBe(404);

    // An update to the older trade, made after they joined, is not theirs either.
    await act(tradeA, 'MOVE_STOP', { price: String(Number(tradeA.stopLoss) + 5) });
    const feed = await alerts(sub.client);
    const tradeIds = feed.items.map((a: { tradeId: string | null }) => a.tradeId);
    expect(tradeIds).not.toContain(tradeA.id);
    expect(tradeIds).toContain(tradeB.id);
    expect(feed.unread).toBe(feed.items.length);
  });

  it('notices about the service stay on the board for everyone, but were never their alerts', async () => {
    const notice = await announce('MAINTENANCE');
    const sub = await newSubscriber(30);
    expect(await board(sub.client)).toContain(notice.id);
    const feed = await alerts(sub.client);
    expect(feed.items).toHaveLength(0);
    expect(feed.unread).toBe(0);
  });

  it('the live stream skips updates to a trade published before they joined', async () => {
    const older = await activeTrade();
    const sub = await newSubscriber(30);
    const live = await LiveClient.connect(sub.client.cookie);
    live.hello(await headSeq(sub.client));
    await act(older, 'MOVE_STOP', { price: String(Number(older.stopLoss) + 5) });
    const fresh = await publish();
    await live.waitForEvent((e) => e.tradeId === fresh.id);
    expect(live.events.map((e) => e.tradeId)).not.toContain(older.id);
    live.close();
  });

  it('without a subscription, nothing private is reachable', async () => {
    const sub = await newSubscriber(30);
    await admin().post(`/admin/subscribers/${sub.id}/adjust`, {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      activationDate: '2026-01-01',
      note: 'ended for the test',
      idempotencyKey: randomUUID(),
    });
    for (const path of ['/signals?status=ALL', '/trades/history', '/announcements', '/notifications']) {
      expect((await sub.client.get(path)).status).toBe(403);
    }
  });
});

describe('a member who renewed after a lapse', () => {
  it('keeps what was published while entitled, and never sees what was published during the lapse', async () => {
    const sub = await newSubscriber(30);
    const firstPeriod = await publish();
    const firstNews = await announce();

    const ended = await admin().post(`/admin/subscribers/${sub.id}/adjust`, {
      expiresAt: new Date(Date.now() - 500).toISOString(),
      activationDate: new Date(Date.now() - DAY).toISOString().slice(0, 10),
      note: 'ended for the test',
      idempotencyKey: randomUUID(),
    });
    expect(ended.status).toBeLessThan(300);
    const lapse = await publish();
    const lapseNews = await announce();

    const renewed = await admin().post(`/admin/subscribers/${sub.id}/start`, {
      durationDays: 30,
      idempotencyKey: randomUUID(),
    });
    expect(renewed.status).toBeLessThan(300);
    const now = await publish();
    const nowNews = await announce();

    const seen = await history(sub.client);
    expect(seen).toEqual(expect.arrayContaining([firstPeriod.id, now.id]));
    expect(seen).not.toContain(lapse.id);
    expect((await sub.client.get(`/trades/${lapse.id}`)).status).toBe(404);
    const news = await board(sub.client);
    expect(news).toEqual(expect.arrayContaining([firstNews.id, nowNews.id]));
    expect(news).not.toContain(lapseNews.id);
    const alertTrades = (await alerts(sub.client)).items.map((a: { tradeId: string | null }) => a.tradeId);
    expect(alertTrades).not.toContain(lapse.id);
  });
});
