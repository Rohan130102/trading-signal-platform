import { describe, expect, it } from 'vitest';
import { act, admin, newSubscriber, nextEntry, publish, signalBody } from './helpers.js';

/** Range trades announced ahead, with no target or stop-loss until they are activated. */
async function upcoming(direction: 'BUY' | 'SELL' = 'BUY') {
  const low = nextEntry();
  const trade = await publish({
    direction,
    entryType: 'RANGE',
    entryLow: String(low),
    entryHigh: String(low + 20),
    targets: [],
    stopLoss: undefined,
  });
  return { trade, low };
}

describe('upcoming range trades', () => {
  it('publish with no target or stop-loss, waiting for activation, and read as an upcoming trade', async () => {
    const { trade, low } = await upcoming();
    expect(trade).toMatchObject({ status: 'PUBLISHED', entryType: 'RANGE', stopLoss: null, originalStopLoss: null, targets: [] });
    const published = trade.events[0];
    expect(published.title).toBe('Upcoming trade: BUY XAU/USD');
    expect(published.body).toBe(
      `Entry zone: ${low.toLocaleString('en-US')}.00 to ${(low + 20).toLocaleString('en-US')}.00\nAwaiting activation`,
    );
    expect(published.body).not.toMatch(/Target|Stop/);

    const sub = await newSubscriber(5);
    const seen = (await sub.client.get(`/trades/${trade.id}`)).body;
    expect(seen).toMatchObject({ status: 'PUBLISHED', stopLoss: null, targets: [] });
    expect((await sub.client.get('/trades/active')).body.trades.some((t: { id: string }) => t.id === trade.id)).toBe(true);
  });

  it('is never active at publication, whatever was asked for', async () => {
    const low = nextEntry();
    const body = await signalBody({
      entryType: 'RANGE',
      entryLow: String(low),
      entryHigh: String(low + 20),
      targets: [],
      stopLoss: undefined,
      activateOnPublish: true,
    });
    const res = await admin().post('/admin/signals', body);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('LEVELS_REQUIRED');
  });

  it('activates only with a final entry, a target and a stop-loss on the right sides', async () => {
    const { trade, low } = await upcoming();
    const missing = await act(trade, 'ACTIVATE');
    expect(missing.status).toBe(422);
    expect(missing.body.error.code).toBe('LEVELS_REQUIRED');
    const wrongSide = await act(trade, 'ACTIVATE', {
      entryPrice: String(low + 10),
      targets: [String(low - 50)],
      stopLoss: String(low - 100),
    });
    expect(wrongSide.status).toBe(422);

    const res = await act(trade, 'ACTIVATE', {
      entryPrice: String(low + 10),
      targets: [String(low + 160)],
      stopLoss: String(low - 170),
    });
    expect(res.status).toBe(201);
    const active = res.body.trade;
    // The same trade, now with its levels; the publication stays in its timeline.
    expect(active).toMatchObject({
      id: trade.id,
      ref: trade.ref,
      status: 'ACTIVE',
      entryType: 'SINGLE',
      entryLow: String(low + 10),
      stopLoss: String(low - 170),
      originalStopLoss: String(low - 170),
    });
    expect(active.targets.map((t: { price: string }) => t.price)).toEqual([String(low + 160)]);
    expect(active.events.map((e: { type: string }) => e.type)).toEqual(['SIGNAL_PUBLISHED', 'ENTRY_ACTIVATED']);
    const activation = active.events[1];
    expect(activation.title).toBe('Trade active: BUY XAU/USD');
    expect(activation.body).toContain(`Entry: ${(low + 10).toLocaleString('en-US')}.00`);
    expect(activation.body).toContain(`Target 1: ${(low + 160).toLocaleString('en-US')}.00`);
    expect(activation.body).toContain(`Stop-loss: ${(low - 170).toLocaleString('en-US')}.00`);
    expect(active.events[0].payload.entryLow).toBe(String(low));

    // A second activation is refused; the version check also stops a stale one.
    const twice = await act(active, 'ACTIVATE', {
      entryPrice: String(low + 10),
      targets: [String(low + 160)],
      stopLoss: String(low - 170),
    });
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('INVALID_TRANSITION');
    const stale = await act(trade, 'ACTIVATE', {
      entryPrice: String(low + 10),
      targets: [String(low + 160)],
      stopLoss: String(low - 170),
    });
    expect(stale.status).toBe(409);
  });

  it('applies SELL rules too', async () => {
    const { trade, low } = await upcoming('SELL');
    const res = await act(trade, 'ACTIVATE', {
      entryPrice: String(low + 10),
      targets: [String(low - 150)],
      stopLoss: String(low + 190),
    });
    expect(res.status).toBe(201);
  });

  it('cannot have its stop moved before it has one, and can be cancelled', async () => {
    const { trade } = await upcoming();
    const move = await act(trade, 'MOVE_STOP', { price: '100', allowWiden: false });
    expect(move.status).toBe(422);
    expect(move.body.error.code).toBe('LEVELS_PENDING');
    const cancelled = await act(trade, 'CANCEL');
    expect(cancelled.status).toBe(201);
    expect(cancelled.body.trade.status).toBe('CANCELLED');
  });

  it('leaves single-price publication unchanged: it still needs a target and a stop-loss', async () => {
    const res = await admin().post('/admin/signals', await signalBody({ targets: [], stopLoss: undefined }));
    expect(res.status).toBe(422);
    const ranged = nextEntry();
    const half = await admin().post(
      '/admin/signals',
      await signalBody({ entryType: 'RANGE', entryLow: String(ranged), entryHigh: String(ranged + 20), stopLoss: undefined }),
    );
    expect(half.status).toBe(422);
  });
});

describe('history', () => {
  it('shows a closed trade at once, with no approval step, and takes it off the live list', async () => {
    const sub = await newSubscriber(5);
    const { trade, low } = await upcoming();
    const active = (
      await act(trade, 'ACTIVATE', { entryPrice: String(low + 10), targets: [String(low + 160)], stopLoss: String(low - 170) })
    ).body.trade;
    const closed = await act(active, 'CLOSE', {
      exitPrice: String(low + 110),
      basis: 'HYPOTHETICAL_OUTCOME',
      reason: 'MANUAL',
      confirm: true,
    });
    expect(closed.status).toBe(201);
    const history = (await sub.client.get(`/trades/history?q=${trade.ref}`)).body.trades;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ status: 'CLOSED', outcome: { weightedPoints: '100' } });
    const live = (await sub.client.get('/trades/active')).body.trades;
    expect(live.some((t: { id: string }) => t.id === trade.id)).toBe(false);
  });
});
