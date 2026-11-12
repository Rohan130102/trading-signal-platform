import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  act,
  activeTrade,
  admin,
  instrumentId,
  newSubscriber,
  nextEntry,
  publish,
  signalBody,
  withDb,
} from './helpers.js';

describe('publishing', () => {
  it('publishes a BUY matching the requested presets and persists the exact message', async () => {
    const trade = await publish({ entry: 3300, confirmDuplicate: true });
    expect(trade).toMatchObject({
      status: 'PUBLISHED',
      direction: 'BUY',
      entryLow: '3300',
      stopLoss: '3120',
      originalStopLoss: '3120',
      version: 1,
    });
    expect(trade.targets[0]).toMatchObject({ index: 1, price: '3450', status: 'OPEN' });
    const event = trade.events[0];
    expect(event.title).toBe('New signal: BUY XAU/USD');
    expect(event.body).toContain('Entry: 3,300.00');
    expect(event.body).toContain('Target 1: 3,450.00');
    expect(event.body).toContain('Stop-loss: 3,120.00');
    expect(event.body).not.toContain('Target 2');
  });

  it('publishes a SELL with an entry range', async () => {
    const low = nextEntry();
    const trade = await publish({
      entry: low,
      direction: 'SELL',
      entryType: 'RANGE',
      entryLow: String(low),
      entryHigh: String(low + 10),
      targets: [String(low - 150)],
      stopLoss: String(low + 10 + 180),
    });
    expect(trade.status).toBe('PUBLISHED');
    expect(trade.entryType).toBe('RANGE');
    expect(trade.events[0].title).toBe('New signal: SELL XAU/USD');
  });

  it('a published signal is awaiting entry, never assumed filled', async () => {
    const trade = await publish();
    expect(trade.status).toBe('PUBLISHED');
    expect(trade.activatedAt).toBeNull();
    expect(trade.execution).toBeNull();
  });

  it('rejects contradictory levels on the server, whatever the client sent', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ stopLoss: '999999' }, 'STOP_SIDE'],
      [{ targets: ['1'] }, 'TARGET_SIDE'],
      [{ entryLow: '3300.123', entryHigh: '3300.123' }, 'VALIDATION'],
      [{ entryType: 'RANGE', entryLow: '3400', entryHigh: '3300' }, 'RANGE_INVERTED'],
    ];
    for (const [overrides, code] of cases) {
      const res = await admin().post('/admin/signals', await signalBody(overrides));
      expect(res.status).toBe(422);
      if (code !== 'VALIDATION') {
        expect(res.body.error.details.issues.map((i: { code: string }) => i.code)).toContain(code);
      }
    }
  });

  it('rejects unknown fields and invalid types', async () => {
    const body = await signalBody();
    expect((await admin().post('/admin/signals', { ...body, sneaky: true })).status).toBe(422);
    expect((await admin().post('/admin/signals', { ...body, stopLoss: 3120 })).status).toBe(422);
    expect((await admin().post('/admin/signals', { ...body, entryLow: '1e5' })).status).toBe(422);
    expect((await admin().post('/admin/signals', { ...body, direction: 'HOLD' })).status).toBe(422);
  });

  it('records the instrument configuration, so editing it later does not change history', async () => {
    const created = await admin().post('/admin/instruments', {
      symbol: `TST${Date.now().toString(36).toUpperCase().slice(-5)}/USD`,
      displayName: 'Test',
      assetClass: 'OTHER',
      quoteCurrency: 'USD',
      pricePrecision: 1,
      tickSize: '0.5',
      pointSize: '10',
      defaultTargetPoints: '15',
      defaultStopPoints: '18',
      contractMultiplier: '100',
      unitLabel: 'lot',
    });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    const trade = await publish({ instrumentId: id, entry: 1000, targets: ['1150'], stopLoss: '820' });
    expect(trade.pointSize).toBe('10');

    const { id: _i, active: _a, sortOrder: _s, archivedAt: _ar, tradeCount: _tc, ...spec } = created.body;
    const edited = await admin().req('PUT', `/admin/instruments/${id}`, { ...spec, pointSize: '5' });
    expect(edited.status).toBe(200);
    const after = await admin().get(`/admin/trades/${trade.id}`);
    expect(after.body.pointSize).toBe('10');

    await admin().req('PUT', `/admin/instruments/${id}`, { ...spec, active: false });
    const blocked = await admin().post(
      '/admin/signals',
      await signalBody({ instrumentId: id, entry: 1100, targets: ['1250'], stopLoss: '920' }),
    );
    expect(blocked.body.error.code).toBe('INSTRUMENT_INACTIVE');
  });

  it('rejects an instrument whose offsets do not land on a tick', async () => {
    const res = await admin().post('/admin/instruments', {
      symbol: 'BADTICK',
      displayName: 'Bad',
      assetClass: 'OTHER',
      quoteCurrency: 'USD',
      pricePrecision: 1,
      tickSize: '0.5',
      pointSize: '0.3',
      defaultTargetPoints: '1',
      defaultStopPoints: '1',
      unitLabel: 'x',
    });
    expect(res.status).toBe(422);
  });

  it('applies the template wording administrators set, and keeps old messages as sent', async () => {
    const list = await admin().get('/admin/templates');
    const template = list.body.templates.find(
      (t: { kind: string; isDefault: boolean }) => t.kind === 'BUY_STANDARD' && t.isDefault,
    );
    const before = await publish();
    const edit = {
      name: template.name,
      tone: template.tone,
      title: 'BUY NOW {{instrument}}',
      body: template.body,
      active: true,
      favorite: true,
    };
    expect((await admin().req('PUT', `/admin/templates/${template.id}`, edit)).status).toBe(200);
    const after = await publish();
    expect(after.events[0].title).toBe('BUY NOW XAU/USD');
    const reread = await admin().get(`/admin/trades/${before.id}`);
    expect(reread.body.events[0].title).toBe('New signal: BUY XAU/USD');
    await admin().req('PUT', `/admin/templates/${template.id}`, { ...edit, title: template.title, favorite: false });
    const bad = await admin().req('PUT', `/admin/templates/${template.id}`, { ...edit, title: '{{secretField}}' });
    expect(bad.status).toBe(422);
  });

  it('refuses a template written for the opposite direction', async () => {
    const list = await admin().get('/admin/templates');
    const sell = list.body.templates.find((t: { kind: string }) => t.kind === 'SELL_STANDARD');
    const res = await admin().post('/admin/signals', await signalBody({ templateId: sell.id }));
    expect(res.body.error.code).toBe('TEMPLATE_MISMATCH');
  });

  it('stores all of this as an audit record', async () => {
    const trade = await publish();
    const log = await admin().get(`/admin/audit?targetId=${trade.id}`);
    expect(log.body.entries[0]).toMatchObject({ action: 'SIGNAL_PUBLISHED', actorName: 'Root Admin' });
  });
});

describe('duplicate protection', () => {
  it('twenty simultaneous submissions with one key create exactly one signal', async () => {
    const body = await signalBody();
    const responses = await Promise.all(Array.from({ length: 20 }, () => admin().post('/admin/signals', body)));
    expect(responses.every((r) => r.status === 201)).toBe(true);
    const ids = new Set(responses.map((r) => r.body.trade.id));
    expect(ids.size).toBe(1);
    expect(responses.filter((r) => r.body.replayed === false)).toHaveLength(1);
    const count = await withDb((db) =>
      db.query('SELECT count(*)::int AS n FROM signal_events WHERE idempotency_key = $1', [body.idempotencyKey]),
    );
    expect(count.rows[0].n).toBe(1);
    const outbox = await withDb((db) =>
      db.query(
        'SELECT count(*)::int AS n FROM outbox_events o JOIN signal_events e ON e.id = o.event_id WHERE e.trade_id = $1',
        [[...ids][0]],
      ),
    );
    expect(outbox.rows[0].n).toBe(1);
  });

  it('a retry after a lost response returns the same signal', async () => {
    const body = await signalBody();
    const first = await admin().post('/admin/signals', body);
    const second = await admin().post('/admin/signals', body);
    expect(second.body.trade.id).toBe(first.body.trade.id);
    expect(second.body.replayed).toBe(true);
  });

  it('warns about a similar live signal and lets the administrator override', async () => {
    const entry = nextEntry();
    const first = await publish({ entry });
    const warned = await admin().post('/admin/signals', await signalBody({ entry }));
    expect(warned.status).toBe(409);
    expect(warned.body.error.code).toBe('DUPLICATE_SIGNAL');
    expect(warned.body.error.details.ref).toBe(first.ref);
    const forced = await admin().post('/admin/signals', await signalBody({ entry, confirmDuplicate: true }));
    expect(forced.status).toBe(201);
    expect(forced.body.trade.id).not.toBe(first.id);
  });

  it('a repeated update command applies once', async () => {
    const trade = await activeTrade();
    const key = randomUUID();
    const command = { action: 'URGENT', expectedVersion: trade.version, idempotencyKey: key, message: 'Tighten up.' };
    const [a, b] = await Promise.all([
      admin().post(`/admin/trades/${trade.id}/events`, command),
      admin().post(`/admin/trades/${trade.id}/events`, command),
    ]);
    expect(a?.status).toBe(201);
    expect(b?.status).toBe(201);
    const detail = await admin().get(`/admin/trades/${trade.id}`);
    expect(detail.body.events.filter((e: { type: string }) => e.type === 'URGENT_INSTRUCTION')).toHaveLength(1);
  });

  it('a request key cannot be reused against a different trade', async () => {
    const [one, two] = [await activeTrade(), await activeTrade()];
    const key = randomUUID();
    await admin().post(`/admin/trades/${one.id}/events`, {
      action: 'URGENT',
      expectedVersion: one.version,
      idempotencyKey: key,
      message: 'x',
    });
    const reused = await admin().post(`/admin/trades/${two.id}/events`, {
      action: 'URGENT',
      expectedVersion: two.version,
      idempotencyKey: key,
      message: 'x',
    });
    expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });
});

describe('drafts', () => {
  it('saves an incomplete draft, updates it, and publishes it once', async () => {
    const id = await instrumentId();
    const draft = await admin().post('/admin/drafts', { instrumentId: id, direction: 'BUY' });
    expect(draft.status).toBe(201);
    const updated = await admin().req('PUT', `/admin/drafts/${draft.body.id}`, {
      instrumentId: id,
      direction: 'SELL',
      entryLow: '3',
    });
    expect(updated.body.version).toBe(2);
    const listed = await admin().get('/admin/drafts');
    expect(listed.body.drafts.map((d: { id: string }) => d.id)).toContain(draft.body.id);

    const body = await signalBody({ draftId: draft.body.id, draftVersion: 1 });
    const stale = await admin().post('/admin/signals', body);
    expect(stale.body.error.code).toBe('DRAFT_CHANGED');
    const ok = await admin().post('/admin/signals', await signalBody({ draftId: draft.body.id, draftVersion: 2 }));
    expect(ok.status).toBe(201);
    expect(ok.body.trade.id).toBe(draft.body.id);
    expect(ok.body.trade.ref).toMatch(/^T-\d{4,}$/);
    const again = await admin().post('/admin/signals', await signalBody({ draftId: draft.body.id }));
    expect(again.body.error.code).toBe('DRAFT_CHANGED');
  });

  it('a published trade cannot be deleted through the draft route', async () => {
    const trade = await publish();
    const res = await admin().req('DELETE', `/admin/drafts/${trade.id}`);
    expect(res.status).toBe(404);
    expect((await admin().get(`/admin/trades/${trade.id}`)).status).toBe(200);
  });

  it('discards a draft', async () => {
    const draft = await admin().post('/admin/drafts', { direction: 'BUY' });
    expect((await admin().req('DELETE', `/admin/drafts/${draft.body.id}`)).status).toBe(200);
    expect((await admin().req('DELETE', `/admin/drafts/${draft.body.id}`)).status).toBe(404);
  });
});

describe('the worked example from the brief', () => {
  it('BUY XAU/USD 3300 / 3450 / 3120, then MOVE SL TO 3350', async () => {
    const published = await publish({ entry: 3300, confirmDuplicate: true });
    const active = (await act(published, 'ACTIVATE')).body.trade;
    const res = await act(active, 'MOVE_STOP', { price: '3350' });
    expect(res.status).toBe(201);
    const trade = res.body.trade;
    expect(trade.stopLoss).toBe('3350');
    expect(trade.originalStopLoss).toBe('3120');
    const event = trade.events[trade.events.length - 1];
    expect(event.type).toBe('STOP_MOVED');
    expect(event.title).toBe('Move stop-loss to 3,350.00: BUY XAU/USD');
    expect(event.payload).toMatchObject({ previousStop: '3120', newStop: '3350' });
    expect(event.actorName).toBe('Root Admin');
    expect(event.tradeId).toBe(trade.id);
    expect(Number.isNaN(Date.parse(event.createdAt))).toBe(false);
    const first = trade.events[0];
    expect(first.payload.after.stopLoss).toBe('3120');
  });
});

describe('concurrent changes', () => {
  it('when two administrators act on one version, one wins and one is told to refresh', async () => {
    const trade = await activeTrade();
    const results = await Promise.all([
      act(trade, 'MOVE_STOP', { price: String(Number(trade.stopLoss) + 10) }),
      act(trade, 'MOVE_STOP', { price: String(Number(trade.stopLoss) + 20) }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    const loser = results.find((r) => r.status === 409);
    expect(loser?.body.error.code).toBe('STALE_VERSION');
    const detail = await admin().get(`/admin/trades/${trade.id}`);
    expect(detail.body.events.filter((e: { type: string }) => e.type === 'STOP_MOVED')).toHaveLength(1);
  });

  it('a stale screen cannot overwrite a newer update', async () => {
    const trade = await activeTrade();
    const first = await act(trade, 'MOVE_STOP', { price: String(Number(trade.stopLoss) + 10) });
    expect(first.status).toBe(201);
    const stale = await act(trade, 'MOVE_STOP', { price: String(Number(trade.stopLoss) + 99) });
    expect(stale.status).toBe(409);
    expect((await admin().get(`/admin/trades/${trade.id}`)).body.stopLoss).toBe(first.body.trade.stopLoss);
  });

  it('many parallel updates produce gap-free versions', async () => {
    const trade = await activeTrade();
    let version = trade.version;
    await Promise.all(
      Array.from({ length: 10 }, () => act({ id: trade.id, version }, 'URGENT', { message: 'hold' })),
    ).then((rs) => {
      expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    });
    version += 1;
    const versions = await withDb((db) =>
      db.query('SELECT trade_version FROM signal_events WHERE trade_id = $1 ORDER BY seq', [trade.id]),
    );
    expect(versions.rows.map((r) => r.trade_version)).toEqual(Array.from({ length: version }, (_, i) => i + 1));
  });
});

describe('lifecycle over HTTP', () => {
  it('rejects actions the current state does not allow', async () => {
    const trade = await publish();
    const closeEarly = await act(trade, 'CLOSE', { exitPrice: '1', basis: 'NONE', reason: 'MANUAL', confirm: true });
    expect(closeEarly.status).toBe(409);
    expect(closeEarly.body.error.code).toBe('INVALID_TRANSITION');
    const cancelled = await act(trade, 'CANCEL', { comment: 'Setup invalidated before entry' });
    expect(cancelled.body.trade.status).toBe('CANCELLED');
    const after = await act(cancelled.body.trade, 'ACTIVATE');
    expect(after.status).toBe(409);
    // Only a correction remains possible.
    expect(cancelled.body.trade.allowedActions).toEqual(['CORRECT']);
  });

  it('runs a full lifecycle with partial exits and aggregates them correctly', async () => {
    const entry = nextEntry();
    const published = await publish({ entry, targets: [String(entry + 100), String(entry + 200)] });
    let trade = (await act(published, 'ACTIVATE', { actualEntry: String(entry), quantity: '10' })).body.trade;
    expect(trade.execution).toMatchObject({ entryPrice: String(entry), quantity: '10' });
    trade = (await act(trade, 'TARGET_HIT', { targetIndex: 1 })).body.trade;
    expect(trade.targets.map((t: { status: string }) => t.status)).toEqual(['HIT', 'OPEN']);
    trade = (await act(trade, 'MOVE_STOP_BREAKEVEN')).body.trade;
    expect(trade.stopLoss).toBe(String(entry));
    trade = (
      await act(trade, 'BOOK_PARTIAL', {
        exitPrice: String(entry + 100),
        percent: '50',
        basis: 'ADMIN_DECLARED_EXECUTION',
        fees: '5',
      })
    ).body.trade;
    expect(trade.status).toBe('PARTIALLY_CLOSED');
    trade = (await act(trade, 'TRAIL_STOP', { referencePrice: String(entry + 150), trailPoints: '20' })).body.trade;
    expect(trade.stopLoss).toBe(String(entry + 130));
    const close = await act(trade, 'CLOSE', {
      exitPrice: String(entry + 200),
      basis: 'ADMIN_DECLARED_EXECUTION',
      reason: 'TARGET_ACHIEVED',
      fees: '5',
      confirm: true,
    });
    trade = close.body.trade;
    expect(trade.status).toBe('CLOSED');
    expect(trade.closedFraction).toBe('1');
    expect(trade.aggregate).toMatchObject({
      grossPnl: '1500', // 5 x 100 + 5 x 200
      netPnl: '1490',
      weightedPoints: '150',
      averageExit: String(entry + 150),
      outcome: 'WIN',
      basis: 'ADMIN_DECLARED_EXECUTION',
    });
    expect(trade.closures.every((c: { methodologyVersion: string }) => c.methodologyVersion === 'pnl-v1')).toBe(true);
  });

  it('never closes more than the position', async () => {
    const trade = await activeTrade();
    const first = await act(trade, 'BOOK_PARTIAL', {
      exitPrice: trade.targets[0].price,
      percent: '70',
      basis: 'HYPOTHETICAL_OUTCOME',
    });
    const over = await act(first.body.trade, 'BOOK_PARTIAL', {
      exitPrice: trade.targets[0].price,
      percent: '40',
      basis: 'HYPOTHETICAL_OUTCOME',
    });
    expect(over.body.error.code).toBe('EXCEEDS_POSITION');
  });

  it('closure with insufficient data produces no monetary result', async () => {
    const low = nextEntry();
    const published = await publish({
      entry: low,
      entryType: 'RANGE',
      entryLow: String(low),
      entryHigh: String(low + 10),
      targets: [String(low + 160)],
      stopLoss: String(low - 180),
    });
    const trade = (await act(published, 'ACTIVATE')).body.trade;
    const noEntry = await act(trade, 'CLOSE', {
      exitPrice: String(low + 100),
      basis: 'HYPOTHETICAL_OUTCOME',
      reason: 'MANUAL',
      confirm: true,
    });
    expect(noEntry.body.error.code).toBe('HYPOTHETICAL_ENTRY_REQUIRED');
    const declared = await act(trade, 'CLOSE', {
      exitPrice: String(low + 100),
      basis: 'ADMIN_DECLARED_EXECUTION',
      reason: 'MANUAL',
      confirm: true,
    });
    expect(declared.body.error.code).toBe('EXECUTION_REQUIRED');
    const closed = await act(trade, 'CLOSE', {
      exitPrice: String(low + 100),
      basis: 'NONE',
      reason: 'MANUAL',
      confirm: true,
    });
    expect(closed.status).toBe(201);
    expect(closed.body.trade.aggregate).toMatchObject({
      grossPnl: null,
      netPnl: null,
      weightedPoints: null,
      outcome: 'UNRESOLVED',
    });
    expect(closed.body.trade.closures[0]).toMatchObject({ priceMove: null, grossPnl: null, netPnl: null });
    const last = closed.body.trade.events.at(-1);
    expect(last.body).not.toContain('Move recorded');
  });

  it('corrects an exit visibly: the old record stays, flagged, and only the new one counts', async () => {
    const trade = await activeTrade();
    const entry = Number(trade.entryLow);
    const closed = (
      await act(trade, 'CLOSE', {
        exitPrice: String(entry + 10),
        basis: 'HYPOTHETICAL_OUTCOME',
        reason: 'MANUAL',
        confirm: true,
      })
    ).body.trade;
    const closureId = closed.closures[0].id;
    const fixed = await act(closed, 'CORRECT', {
      reason: 'Exit was mistyped',
      closureId,
      exitPrice: String(entry + 100),
    });
    expect(fixed.status).toBe(201);
    const after = fixed.body.trade;
    expect(after.closures).toHaveLength(2);
    expect(after.closures[0].superseded).toBe(true);
    expect(after.closures[1].superseded).toBe(false);
    expect(after.aggregate.weightedPoints).toBe('100');
    const event = after.events.at(-1);
    expect(event.type).toBe('CORRECTION');
    expect(event.body).toContain('Exit was mistyped');
    expect(event.payload.changes[0].field).toBe('Exit price');
  });

  it('records the actual entry after a range signal closed, and measures the exit from it everywhere', async () => {
    const low = nextEntry();
    const trade = await activeTrade({
      entryType: 'RANGE',
      entryLow: String(low),
      entryHigh: String(low + 50),
      targets: [String(low + 250)],
      stopLoss: String(low - 180),
    });
    const closed = (
      await act(trade, 'CLOSE', { exitPrice: String(low + 200), basis: 'NONE', reason: 'MANUAL', confirm: true })
    ).body.trade;
    expect(closed.closures[0].points).toBeNull();

    const fixed = await act(closed, 'CORRECT', {
      reason: 'Filled at the top of the range',
      actualEntry: String(low + 50),
    });
    expect(fixed.status).toBe(201);
    const after = fixed.body.trade;
    expect(after.status).toBe('CLOSED');
    expect(after.execution).toMatchObject({ entryPrice: String(low + 50), quantity: null });
    expect(after.closures.map((c: { superseded: boolean; basis: string }) => [c.superseded, c.basis])).toEqual([
      [true, 'NONE'],
      [false, 'ADMIN_DECLARED_EXECUTION'],
    ]);
    expect(after.aggregate).toMatchObject({ weightedPoints: '150', outcome: 'WIN' });
    expect(after.events.slice(-2).map((e: { type: string }) => e.type)).toEqual(['EXECUTION_RECORDED', 'CORRECTION']);
    expect(after.events.at(-1).body).toContain('+150 pts');

    const stored = await withDb(async (db) => ({
      executions: (
        await db.query('SELECT entry_price::text AS p FROM trade_execution_records WHERE trade_id = $1', [trade.id])
      ).rows,
      trade: (await db.query('SELECT closure_basis, execution_entry::text AS e FROM trades WHERE id = $1', [trade.id]))
        .rows[0],
    }));
    expect(stored.executions.map((r: { p: string }) => Number(r.p))).toEqual([low + 50]);
    expect(stored.trade).toMatchObject({ closure_basis: 'ADMIN_DECLARED_EXECUTION' });
    expect(Number(stored.trade.e)).toBe(low + 50);

    const report = (await admin().get('/admin/performance')).body;
    const record = report.records.find((r: { id: string }) => r.id === trade.id);
    expect(record.corrected).toBe(true);
    expect(record.aggregate).toMatchObject({ weightedPoints: '150', outcome: 'WIN' });
  });

  it('corrects the levels, targets and times of a closed trade', async () => {
    const entry = nextEntry();
    const trade = await activeTrade({ entry, targets: [String(entry + 150), String(entry + 300)] });
    const hit = (await act(trade, 'TARGET_HIT', { targetIndex: 1 })).body.trade;
    const closed = (
      await act(hit, 'CLOSE', {
        exitPrice: String(entry + 150),
        basis: 'HYPOTHETICAL_OUTCOME',
        reason: 'MANUAL',
        confirm: true,
      })
    ).body.trade;
    // The earliest it can be: the moment of publication.
    const activated = new Date(closed.publishedAt).toISOString();
    expect(activated).not.toBe(closed.activatedAt);
    const fixed = await act(closed, 'CORRECT', {
      reason: 'Published levels had typos',
      stopLoss: String(entry - 170),
      targetPrices: [{ index: 1, price: String(entry + 140) }],
      activatedAt: activated,
      closureId: closed.closures[0].id,
      closeReason: 'TARGET_ACHIEVED',
    });
    expect(fixed.body.error ?? null).toBeNull();
    expect(fixed.status).toBe(201);
    const after = fixed.body.trade;
    expect(after).toMatchObject({ status: 'CLOSED', stopLoss: String(entry - 170), activatedAt: activated });
    expect(after.targets[0]).toMatchObject({ index: 1, price: String(entry + 140), status: 'HIT' });
    expect(after.closures.at(-1)).toMatchObject({ superseded: false, reason: 'TARGET_ACHIEVED' });
    expect(after.events.at(-1).payload.changes.map((c: { field: string }) => c.field)).toEqual([
      'Stop-loss',
      'Target 1 (reached)',
      'Activated',
      'Close reason',
    ]);
  });

  it('a trade entry deadline expires it through the sweeper as a visible event', async () => {
    const trade = await publish({ entryExpiresAt: new Date(Date.now() + 500).toISOString() });
    await withDb((db) =>
      db.query("UPDATE trades SET entry_expires_at = now() - interval '1 second' WHERE id = $1", [trade.id]),
    );
    const deadline = Date.now() + 25_000;
    let status = 'PUBLISHED';
    while (Date.now() < deadline && status === 'PUBLISHED') {
      status = (await admin().get(`/admin/trades/${trade.id}`)).body.status;
      await new Promise((r) => setTimeout(r, 300));
    }
    expect(status).toBe('EXPIRED');
    const after = await admin().get(`/admin/trades/${trade.id}`);
    expect(after.body.events.at(-1)).toMatchObject({ type: 'ENTRY_EXPIRED', actorName: null });
  });

  it('rejects a deadline in the past', async () => {
    const res = await admin().post('/admin/signals', await signalBody({ entryExpiresAt: '2020-01-01T00:00:00Z' }));
    expect(res.status).toBe(422);
  });
});

describe('database guarantees', () => {
  it('stores true instants: a timestamp written by the app matches the database clock', async () => {
    const trade = await publish();
    const row = await withDb((db) =>
      db.query(
        'SELECT extract(epoch FROM published_at) AS at, extract(epoch FROM now()) AS now, current_setting($1) AS tz FROM trades WHERE id = $2',
        ['TimeZone', trade.id],
      ),
    );
    expect(Math.abs(Number(row.rows[0].now) - Number(row.rows[0].at))).toBeLessThan(5);
    expect(row.rows[0].tz).toBe('UTC');
    expect(Math.abs(Date.parse(trade.publishedAt) - Number(row.rows[0].at) * 1000)).toBeLessThan(2000);
  });

  it('signal events cannot be changed or deleted, even with direct database access', async () => {
    const trade = await publish();
    await withDb(async (db) => {
      await expect(
        db.query("UPDATE signal_events SET title = 'forged' WHERE trade_id = $1", [trade.id]),
      ).rejects.toThrow(/append-only/);
      await expect(db.query('DELETE FROM signal_events WHERE trade_id = $1', [trade.id])).rejects.toThrow(
        /append-only/,
      );
      // CASCADE locks every table that references the events, which can deadlock with the worker handling
      // the signal just published. PostgreSQL then cancels the TRUNCATE before the trigger runs, so a
      // deadlock is tried again. Only the trigger's own refusal passes, and nothing else may succeed.
      const refusal = async (): Promise<string> => {
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const message = await db.query('TRUNCATE signal_events CASCADE').then(
            () => 'TRUNCATE succeeded',
            (error: Error) => error.message,
          );
          if (!message.includes('deadlock')) return message;
          await new Promise((r) => setTimeout(r, 300));
        }
        return 'TRUNCATE kept deadlocking';
      };
      expect(await refusal()).toMatch(/append-only/);
      const kept = await db.query('SELECT count(*)::int AS n FROM signal_events WHERE trade_id = $1', [trade.id]);
      expect(kept.rows[0].n).toBeGreaterThan(0);
    });
  });

  it('audit records and subscription history are append-only too', async () => {
    // These triggers fire per row, so an empty table would refuse nothing and prove nothing.
    await newSubscriber();
    await withDb(async (db) => {
      await expect(db.query("UPDATE audit_logs SET action = 'x'")).rejects.toThrow(/append-only/);
      await expect(db.query('DELETE FROM audit_logs')).rejects.toThrow(/append-only/);
      await expect(db.query("UPDATE subscription_events SET note = 'x'")).rejects.toThrow(/append-only/);
    });
  });

  it('an exit record can only gain a pointer to its correction', async () => {
    const trade = await activeTrade();
    const closed = (
      await act(trade, 'CLOSE', {
        exitPrice: trade.targets[0].price,
        basis: 'HYPOTHETICAL_OUTCOME',
        reason: 'MANUAL',
        confirm: true,
      })
    ).body.trade;
    await withDb(async (db) => {
      await expect(
        db.query('UPDATE trade_closures SET exit_price = 1 WHERE trade_id = $1', [trade.id]),
      ).rejects.toThrow(/immutable/);
      await expect(db.query('DELETE FROM trade_closures WHERE trade_id = $1', [trade.id])).rejects.toThrow(
        /cannot be deleted/,
      );
    });
    expect(closed.status).toBe('CLOSED');
  });

  it('constraints stop impossible records', async () => {
    const trade = await publish();
    await withDb(async (db) => {
      await expect(db.query('UPDATE trades SET closed_fraction = 1.5 WHERE id = $1', [trade.id])).rejects.toThrow(
        /trades_fraction_bounds/,
      );
      await expect(db.query('UPDATE trades SET entry_low = 999999 WHERE id = $1', [trade.id])).rejects.toThrow(
        /trades_entry_ordered/,
      );
      await expect(db.query('UPDATE trades SET stop_loss = NULL WHERE id = $1', [trade.id])).rejects.toThrow(
        /trades_published_is_complete/,
      );
      await expect(db.query('UPDATE trades SET stop_loss = -1 WHERE id = $1', [trade.id])).rejects.toThrow(
        /trades_prices_positive/,
      );
    });
  });

  it('every broadcast event committed with its outbox row', async () => {
    const orphans = await withDb((db) =>
      db.query(
        `SELECT count(*)::int AS n FROM signal_events e LEFT JOIN outbox_events o ON o.event_id = e.id WHERE e.broadcast AND o.id IS NULL`,
      ),
    );
    expect(orphans.rows[0].n).toBe(0);
  });

  it('a failed action leaves nothing behind: no event, no outbox row, no state change', async () => {
    const trade = await activeTrade();
    const before = await withDb((db) =>
      db.query('SELECT count(*)::int AS n FROM signal_events WHERE trade_id = $1', [trade.id]),
    );
    const failed = await act(trade, 'MOVE_STOP', { price: '0.001' });
    expect(failed.status).toBe(422);
    const after = await withDb((db) =>
      db.query('SELECT count(*)::int AS n FROM signal_events WHERE trade_id = $1', [trade.id]),
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
    expect((await admin().get(`/admin/trades/${trade.id}`)).body.version).toBe(trade.version);
  });

  it('stored state equals the replay of the event history', async () => {
    const trade = await activeTrade();
    const moved = (await act(trade, 'MOVE_STOP', { price: String(Number(trade.stopLoss) + 5) })).body.trade;
    const row = await withDb((db) =>
      db.query(
        "SELECT payload->'after'->>'stopLoss' AS stop, payload->'after'->>'status' AS status FROM signal_events WHERE trade_id = $1 AND broadcast ORDER BY seq DESC LIMIT 1",
        [trade.id],
      ),
    );
    expect(row.rows[0].stop).toBe(moved.stopLoss);
    expect(row.rows[0].status).toBe(moved.status);
  });

  it('sequence numbers are strictly increasing across concurrent publishers', async () => {
    const bodies = await Promise.all(Array.from({ length: 25 }, () => signalBody()));
    const res = await Promise.all(bodies.map((b) => admin().post('/admin/signals', b)));
    expect(res.every((r) => r.status === 201)).toBe(true);
    const seqs = await withDb((db) =>
      db.query('SELECT seq::bigint AS seq, created_at FROM signal_events ORDER BY seq'),
    );
    for (let i = 1; i < seqs.rows.length; i += 1) {
      expect(BigInt(seqs.rows[i].seq)).toBeGreaterThan(BigInt(seqs.rows[i - 1].seq));
      expect(new Date(seqs.rows[i].created_at).getTime()).toBeGreaterThanOrEqual(
        new Date(seqs.rows[i - 1].created_at).getTime(),
      );
    }
  });

  it('the hash chain verifies, and detects tampering that bypasses the triggers', async () => {
    const clean = await admin().get('/admin/integrity');
    expect(clean.body.intact).toBe(true);
    expect(clean.body.checked).toBeGreaterThan(0);
    const trade = await publish();
    const original = trade.events[0].title;
    await withDb(async (db) => {
      await db.query('ALTER TABLE signal_events DISABLE TRIGGER signal_events_append_only');
      await db.query("UPDATE signal_events SET title = 'Forged result' WHERE trade_id = $1", [trade.id]);
    });
    const tampered = await admin().get('/admin/integrity');
    expect(tampered.body.intact).toBe(false);
    expect(tampered.body.firstBadSeq).toBe(trade.events[0].seq);
    await withDb(async (db) => {
      await db.query('UPDATE signal_events SET title = $1 WHERE trade_id = $2', [original, trade.id]);
      await db.query('ALTER TABLE signal_events ENABLE TRIGGER signal_events_append_only');
    });
    expect((await admin().get('/admin/integrity')).body.intact).toBe(true);
  });
});

describe('announcements', () => {
  it('publishes once per key and is not tied to any trade', async () => {
    const key = randomUUID();
    const first = await admin().post('/admin/announcements', {
      message: 'Markets closed Friday.',
      idempotencyKey: key,
    });
    const second = await admin().post('/admin/announcements', {
      message: 'Markets closed Friday.',
      idempotencyKey: key,
    });
    expect(first.body.eventId).toBe(second.body.eventId);
    expect(second.body.replayed).toBe(true);
    const row = await withDb((db) =>
      db.query('SELECT trade_id, title FROM signal_events WHERE id = $1', [first.body.eventId]),
    );
    expect(row.rows[0].trade_id).toBeNull();
    expect(row.rows[0].title).toBe('Market update');
  });
});

describe('performance report currencies', () => {
  it('will not add up money across different quote currencies', async () => {
    const created = await admin().post('/admin/instruments', {
      symbol: `EUR${Date.now().toString(36).toUpperCase().slice(-5)}`,
      displayName: 'Euro quoted',
      assetClass: 'OTHER',
      quoteCurrency: 'EUR',
      pricePrecision: 2,
      tickSize: '0.01',
      pointSize: '1',
      defaultTargetPoints: '10',
      defaultStopPoints: '10',
      contractMultiplier: '1',
      unitLabel: 'unit',
    });
    const usd = await publish();
    const usdActive = (await act(usd, 'ACTIVATE', { actualEntry: usd.entryLow, quantity: '1' })).body.trade;
    await act(usdActive, 'CLOSE', {
      exitPrice: String(Number(usd.entryLow) + 5),
      basis: 'ADMIN_DECLARED_EXECUTION',
      reason: 'MANUAL',
      confirm: true,
    });
    const eur = await publish({ instrumentId: created.body.id, entry: 100, targets: ['110'], stopLoss: '90' });
    const eurActive = (await act(eur, 'ACTIVATE', { actualEntry: '100', quantity: '1' })).body.trade;
    await act(eurActive, 'CLOSE', {
      exitPrice: '105',
      basis: 'ADMIN_DECLARED_EXECUTION',
      reason: 'MANUAL',
      confirm: true,
    });

    const all = (await admin().get('/admin/performance')).body;
    expect(all.quoteCurrency).toBeNull();
    expect(all.pointsComparable).toBe(false);
    expect(all.byBasis.find((b: { basis: string }) => b.basis === 'ADMIN_DECLARED_EXECUTION').stats.netPnl).toBeNull();

    const one = (await admin().get(`/admin/performance?symbol=${encodeURIComponent(created.body.symbol)}`)).body;
    expect(one.quoteCurrency).toBe('EUR');
    expect(one.byBasis.find((b: { basis: string }) => b.basis === 'ADMIN_DECLARED_EXECUTION').stats.netPnl).toBe('5');
  });
});

describe('performance report', () => {
  it('counts every record, separates bases and refuses to show money it cannot support', async () => {
    const report = (await admin().get('/admin/performance')).body;
    expect(report.lifecycle.totalRecords).toBeGreaterThan(0);
    expect(report.lifecycle.winRateDenominator).toBe(
      report.lifecycle.wins + report.lifecycle.losses + report.lifecycle.breakevens,
    );
    expect(report.lifecycle.finalized).toBe(report.lifecycle.winRateDenominator + report.lifecycle.unresolved);
    expect(report.lifecycle.cancelled).toBeGreaterThan(0);
    const bases = report.byBasis.map((b: { basis: string }) => b.basis);
    expect(bases).toEqual(['HYPOTHETICAL_OUTCOME', 'ADMIN_DECLARED_EXECUTION']);
    const hypothetical = report.byBasis[0].stats;
    expect(hypothetical.netPnl).toBeNull();
    expect(report.methodology.version).toBe('pnl-v1');
    const filtered = (await admin().get('/admin/performance?symbol=BTC/USD')).body;
    expect(filtered.lifecycle.totalRecords).toBe(0);
  });

  it('a superseded exit never counts towards results', async () => {
    const trade = await activeTrade();
    const entry = Number(trade.entryLow);
    const closed = (
      await act(trade, 'CLOSE', {
        exitPrice: String(entry - 50),
        basis: 'HYPOTHETICAL_OUTCOME',
        reason: 'MANUAL',
        confirm: true,
      })
    ).body.trade;
    const fixed = (
      await act(closed, 'CORRECT', {
        reason: 'Wrong side typed',
        closureId: closed.closures[0].id,
        exitPrice: String(entry + 50),
      })
    ).body.trade;
    expect(fixed.aggregate.outcome).toBe('WIN');
    const report = (await admin().get('/admin/performance')).body;
    const record = report.records.find((r: { id: string }) => r.id === trade.id);
    expect(record.corrected).toBe(true);
    expect(record.aggregate.outcome).toBe('WIN');
  });
});
