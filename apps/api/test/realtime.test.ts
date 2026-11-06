import { describe, expect, it } from 'vitest';
import { act, admin, headSeq, LiveClient, newSubscriber, publish, signalBody, waitUntil } from './helpers.js';

describe('live delivery', () => {
  it('a connected subscriber receives a new signal without any request', async () => {
    const { client } = await newSubscriber(30);
    const live = await LiveClient.connect(client.cookie);
    live.hello(await headSeq(client));
    const trade = await publish();
    const event = await live.waitForEvent((e) => e.tradeId === trade.id);
    expect(event.type).toBe('SIGNAL_PUBLISHED');
    expect(event.payload.symbol).toBe('XAU/USD');
    live.close();
  });

  it('updates arrive tied to their parent trade', async () => {
    const { client } = await newSubscriber(30);
    const live = await LiveClient.connect(client.cookie);
    live.hello(await headSeq(client));
    const trade = await publish();
    const activated = (await act(trade, 'ACTIVATE')).body.trade;
    await act(activated, 'MOVE_STOP', { price: String(Number(trade.stopLoss) + 25) });
    const moved = await live.waitForEvent((e) => e.tradeId === trade.id && e.type === 'STOP_MOVED');
    expect((moved.payload.after as { stopLoss: string }).stopLoss).toBe(String(Number(trade.stopLoss) + 25));
    live.close();
  });

  it('does not stream internal records', async () => {
    const { client } = await newSubscriber(30);
    const live = await LiveClient.connect(client.cookie);
    live.hello(await headSeq(client));
    const trade = await publish();
    await act(trade, 'ACTIVATE', { actualEntry: trade.entryLow, quantity: '3' });
    await live.waitForEvent((e) => e.tradeId === trade.id && e.type === 'ENTRY_ACTIVATED');
    expect(live.events.map((e) => e.type)).not.toContain('EXECUTION_RECORDED');
    live.close();
  });

  it('sends nothing until the client says where it left off', async () => {
    const { client } = await newSubscriber(30);
    const live = await LiveClient.connect(client.cookie);
    await publish();
    await new Promise((r) => setTimeout(r, 300));
    expect(live.events).toHaveLength(0);
    live.close();
  });

  it('closes on a malformed message without affecting others', async () => {
    const { client } = await newSubscriber(30);
    const bad = await LiveClient.connect(client.cookie);
    const good = await LiveClient.connect(client.cookie);
    good.hello(await headSeq(client));
    bad.ws.send('not json');
    expect((await bad.waitForClose()).code).toBe(4400);
    const another = await LiveClient.connect(client.cookie);
    another.ws.send(JSON.stringify({ type: 'hello', lastSeq: -5 }));
    expect((await another.waitForClose()).code).toBe(4400);
    const trade = await publish();
    await good.waitForEvent((e) => e.tradeId === trade.id);
    good.close();
  });

  it('answers application pings', async () => {
    const { client } = await newSubscriber(30);
    const live = await LiveClient.connect(client.cookie);
    live.ws.send(JSON.stringify({ type: 'ping' }));
    await waitUntil(() => live.messages.find((m) => m.type === 'pong'));
    live.close();
  });
});

describe('reconnection', () => {
  it('after a disconnect, all missed events appear exactly once and in order', async () => {
    const { client } = await newSubscriber(30);
    const first = await LiveClient.connect(client.cookie);
    const start = await headSeq(client);
    first.hello(start);
    const trade0 = await publish();
    const seen = await first.waitForEvent((e) => e.tradeId === trade0.id);
    first.ws.terminate();
    await first.waitForClose();

    // Things happen while this client is away.
    const trade1 = await publish();
    const active = (await act(trade1, 'ACTIVATE')).body.trade;
    await act(active, 'MOVE_STOP', { price: String(Number(trade1.stopLoss) + 10) });
    const trade2 = await publish();

    const second = await LiveClient.connect(client.cookie);
    second.hello(seen.seq);
    const last = await second.waitForEvent((e) => e.tradeId === trade2.id);
    const recovered = second.events;
    expect(recovered.map((e) => e.type)).toEqual([
      'SIGNAL_PUBLISHED',
      'ENTRY_ACTIVATED',
      'STOP_MOVED',
      'SIGNAL_PUBLISHED',
    ]);
    expect(recovered[0]?.tradeId).toBe(trade1.id);
    expect(last.tradeId).toBe(trade2.id);

    const seqs = recovered.map((e) => e.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    expect(recovered.find((e) => e.seq <= seen.seq)).toBeUndefined();

    // And live delivery carries on over the same connection.
    const trade3 = await publish();
    await second.waitForEvent((e) => e.tradeId === trade3.id);
    second.close();
  });

  it('recovers more history than one page, still in order', async () => {
    const { client } = await newSubscriber(30);
    const from = await headSeq(client);
    const bodies = await Promise.all(Array.from({ length: 30 }, () => signalBody()));
    for (const body of bodies) await admin().post('/admin/signals', body);
    const live = await LiveClient.connect(client.cookie);
    live.hello(from);
    await waitUntil(() => live.events.length >= 30, 10_000, 'catch-up');
    const seqs = live.events.map((e) => e.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    expect(new Set(seqs).size).toBe(seqs.length);
    const rest = await client.get(`/feed?after=${from}&limit=100`);
    expect(rest.body.events.map((e: { seq: number }) => e.seq)).toEqual(seqs);
    live.close();
  });

  it('events published concurrently reach every client in the same order', async () => {
    const a = await newSubscriber(30);
    const b = await newSubscriber(30);
    const from = await headSeq(a.client);
    const liveA = await LiveClient.connect(a.client.cookie);
    const liveB = await LiveClient.connect(b.client.cookie);
    liveA.hello(from);
    liveB.hello(from);
    const bodies = await Promise.all(Array.from({ length: 25 }, () => signalBody()));
    await Promise.all(bodies.map((body) => admin().post('/admin/signals', body)));
    await waitUntil(() => liveA.events.length >= 25 && liveB.events.length >= 25, 10_000, 'both clients');
    const seqsA = liveA.events.map((e) => e.seq);
    expect(liveB.events.map((e) => e.seq)).toEqual(seqsA);
    expect([...seqsA].sort((x, y) => x - y)).toEqual(seqsA);
    liveA.close();
    liveB.close();
  });

  it('a claimed position beyond the head is clamped, so it cannot hide future events', async () => {
    const { client } = await newSubscriber(30);
    const live = await LiveClient.connect(client.cookie);
    live.hello(Number.MAX_SAFE_INTEGER);
    await waitUntil(() => live.messages.find((m) => m.type === 'ready'));
    const trade = await publish();
    await live.waitForEvent((e) => e.tradeId === trade.id);
    live.close();
  });

  it('the feed API agrees with the socket, including paging and read state', async () => {
    const { client } = await newSubscriber(30);
    const trade = await publish();
    const page = await client.get('/feed?limit=5');
    expect(page.body.events[0].tradeId).toBe(trade.id);
    expect(page.body.unread).toBeGreaterThan(0);
    expect(page.body.lastReadSeq).toBe(0);
    const read = await client.post('/feed/read', { seq: page.body.headSeq });
    expect(read.body.unread).toBe(0);
    const backwards = await client.post('/feed/read', { seq: 1 });
    expect(backwards.body.unread).toBe(0);
    const after = await client.get('/feed?limit=1');
    expect(after.body.lastReadSeq).toBe(page.body.headSeq);
    const older = await client.get(`/feed?before=${page.body.events[0].seq}&limit=2`);
    expect(older.body.events.every((e: { seq: number }) => e.seq < page.body.events[0].seq)).toBe(true);
    const filtered = await client.get('/feed?symbol=BTC/USD');
    expect(filtered.body.events).toHaveLength(0);
  });

  it('the active list and history reflect the current state', async () => {
    const { client } = await newSubscriber(30);
    const trade = await publish();
    const active = await client.get('/trades/active');
    const listed = active.body.trades.find((t: { id: string }) => t.id === trade.id);
    expect(listed).toMatchObject({ status: 'PUBLISHED', stopLoss: trade.stopLoss });
    const cancelled = await act(trade, 'CANCEL');
    expect(cancelled.status).toBe(201);
    const after = await client.get('/trades/active');
    expect(after.body.trades.find((t: { id: string }) => t.id === trade.id)).toBeUndefined();
    const history = await client.get(`/trades/history?q=${trade.ref}`);
    expect(history.body.trades[0].status).toBe('CANCELLED');
    const none = await client.get('/trades/history?q=no-such-thing-at-all');
    expect(none.body.total).toBe(0);
    const dated = await client.get('/trades/history?from=2000-01-01&to=2000-01-02');
    expect(dated.body.total).toBe(0);
  });
});
