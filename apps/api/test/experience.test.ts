import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  act,
  admin,
  Client,
  control,
  ctx,
  instrumentId,
  newSubscriber,
  PASSWORD,
  publish,
  waitUntil,
  withDb,
} from './helpers.js';
import { NativeClient, newInstallationId } from './native.js';

/* Subscriber experience on the mobile app: device binding, grouped signals, hiding, the notification list,
 * announcements with a lifecycle, the administrative archive, instruments and notification metadata. */

async function appSubscriber(installationId = newInstallationId()) {
  const created = await newSubscriber(30);
  const app = new NativeClient(null, installationId);
  const res = await app.login(created.loginId, PASSWORD);
  expect(res.status).toBe(200);
  return { ...created, app };
}

const expoToken = () => `ExponentPushToken[ok${randomBytes(10).toString('hex')}]`;

async function expoFor(token: string, count = 1) {
  return waitUntil(
    async () => {
      const log = (await control('/expo-log')) as { message: Record<string, any> }[];
      const mine = log.filter((e) => e.message.to === token);
      return mine.length >= count ? mine : false;
    },
    15_000,
    `${count} Expo message(s)`,
  );
}

async function cancelled() {
  const trade = await publish();
  const res = await act(trade, 'CANCEL', { comment: 'No longer valid' });
  expect(res.status).toBe(201);
  return res.body.trade as { id: string; version: number; status: string };
}

async function audit(action: string, targetId?: string) {
  return withDb(async (db) => {
    const rows = await db.query(
      `SELECT metadata FROM audit_logs WHERE action = $1 ${targetId ? 'AND target_id = $2' : ''} ORDER BY id DESC`,
      targetId ? [action, targetId] : [action],
    );
    return rows.rows as { metadata: Record<string, unknown> }[];
  });
}

describe('one subscriber per app installation', () => {
  it('binds an installation at first sign-in and lets the same subscriber back in after signing out', async () => {
    const { app, loginId } = await appSubscriber();
    expect((await app.get('/me/device')).body.device).toMatchObject({ platform: 'android', releasedAt: null });
    expect((await app.post('/auth/logout')).status).toBe(200);
    const again = await app.login(loginId, PASSWORD);
    expect(again.status).toBe(200);
  });

  it('refuses a second subscriber on the same installation, even after the first signed out', async () => {
    const installation = newInstallationId();
    const first = await appSubscriber(installation);
    await first.app.post('/auth/logout');
    const second = await newSubscriber(30);
    const res = await new NativeClient(null, installation).login(second.loginId, PASSWORD);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('DEVICE_BOUND');
    expect(res.body.error.message).toMatch(/administrator/i);
    expect((await audit('DEVICE_BINDING_BLOCKED')).length).toBeGreaterThan(0);
  });

  it('checks the password before saying anything about the binding', async () => {
    const installation = newInstallationId();
    await appSubscriber(installation);
    const other = await newSubscriber(30);
    const res = await new NativeClient(null, installation).login(other.loginId, 'not-the-password');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('asks an app that sends no installation to update, and leaves browsers alone', async () => {
    const created = await newSubscriber(30);
    const res = await new NativeClient().post('/auth/token', { identifier: created.loginId, password: PASSWORD });
    expect(res.status).toBe(426);
    expect(res.body.error.code).toBe('APP_UPDATE_REQUIRED');
    const browser = new Client();
    expect((await browser.post('/auth/login', { identifier: created.loginId, password: PASSWORD })).status).toBe(200);
  });

  it('lets exactly one of two subscribers win a simultaneous first sign-in on one installation', async () => {
    const installation = newInstallationId();
    const [a, b] = await Promise.all([newSubscriber(30), newSubscriber(30)]);
    const results = await Promise.all([
      new NativeClient(null, installation).login(a.loginId, PASSWORD),
      new NativeClient(null, installation).login(b.loginId, PASSWORD),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 403]);
    const rows = await withDb((db) =>
      db.query('SELECT count(*)::int AS n FROM device_bindings WHERE installation_id = $1 AND released_at IS NULL', [
        installation,
      ]),
    );
    expect(rows.rows[0].n).toBe(1);
  });

  it('never binds an administrator', async () => {
    const installation = newInstallationId();
    await appSubscriber(installation);
    // The phone is a subscriber's, yet the administrator may still sign in on it, and is not bound.
    const res = await new NativeClient(null, installation).login('root.admin', PASSWORD);
    expect(res.status).toBe(200);
    const rows = await withDb((db) =>
      db.query(
        "SELECT count(*)::int AS n FROM device_bindings b JOIN users u ON u.id = b.user_id WHERE u.role = 'ADMIN'",
      ),
    );
    expect(rows.rows[0].n).toBe(0);
  });

  it('lets an administrator see and release a binding, which signs the old account out of that phone', async () => {
    const installation = newInstallationId();
    const first = await appSubscriber(installation);
    const list = await admin().get(`/admin/subscribers/${first.id}/devices`);
    expect(list.status).toBe(200);
    const [binding] = list.body.devices;
    expect(binding).toMatchObject({ activeSessions: 1, releasedAt: null });

    expect((await admin().post(`/admin/devices/${binding.id}/release`, { reason: 'x' })).status).toBe(422);
    const released = await admin().post(`/admin/devices/${binding.id}/release`, { reason: 'Phone handed to a family member' });
    expect(released.status).toBe(200);
    expect(released.body.sessionsRevoked).toBe(1);
    expect((await first.app.get('/signals')).status).toBe(401);

    const second = await newSubscriber(30);
    expect((await new NativeClient(null, installation).login(second.loginId, PASSWORD)).status).toBe(200);
    const again = await admin().post(`/admin/devices/${binding.id}/release`, { reason: 'Second time' });
    expect(again.status).toBe(409);
    expect((await audit('DEVICE_BINDING_RELEASED', binding.id)).length).toBe(1);
  });

  it('keeps device management away from subscribers', async () => {
    const { app, id } = await appSubscriber();
    expect((await app.get(`/admin/subscribers/${id}/devices`)).status).toBe(403);
    expect((await app.post(`/admin/devices/${randomUUID()}/release`, { reason: 'mine now' })).status).toBe(403);
  });
});

describe('grouped signals', () => {
  it('keeps every update under its trade and moves the trade to the top when it changes', async () => {
    const { app } = await appSubscriber();
    const older = await publish();
    const newer = await publish();
    let page = (await app.get('/signals?limit=50')).body;
    const ids = page.cards.map((c: { id: string }) => c.id);
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));

    const moved = await act(older, 'MOVE_STOP', { price: String(Number(older.stopLoss) + 20) });
    expect(moved.status).toBe(201);
    page = (await app.get('/signals?limit=50')).body;
    expect(page.cards[0].id).toBe(older.id);
    expect(page.cards[0].recentUpdates[0].type).toBe('STOP_MOVED');
    expect(page.cards[0].recentUpdates.every((e: { tradeId: string }) => e.tradeId === older.id)).toBe(true);
    expect(page.cards[0].unread).toBe(true);
    expect(page.cards[0].stopLoss).toBe(moved.body.trade.stopLoss);
  });

  it('pages with a cursor without repeating or skipping a trade', async () => {
    const { app } = await appSubscriber();
    for (let i = 0; i < 5; i += 1) await publish();
    const seen: string[] = [];
    let before: number | null = null;
    for (let i = 0; i < 4; i += 1) {
      const page: { cards: { id: string }[]; nextBefore: number | null } = (
        await app.get(`/signals?limit=2${before ? `&before=${before}` : ''}`)
      ).body;
      seen.push(...page.cards.map((c) => c.id));
      before = page.nextBefore;
      if (!before) break;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThanOrEqual(5);
  });

  it('filters by instrument, direction and status on the server', async () => {
    const { app } = await appSubscriber();
    const sell = await publish({
      direction: 'SELL',
      entry: 5000,
      targets: ['4850'],
      stopLoss: '5180',
      confirmDuplicate: true,
    });
    const page = (await app.get('/signals?direction=SELL&status=AWAITING&symbols=XAU/USD&limit=50')).body;
    expect(page.cards.length).toBeGreaterThan(0);
    expect(page.cards.every((c: { direction: string; status: string; symbol: string }) => c.direction === 'SELL' && c.status === 'PUBLISHED' && c.symbol === 'XAU/USD')).toBe(true);
    expect(page.cards.map((c: { id: string }) => c.id)).toContain(sell.id);
    const none = await app.get('/signals?symbols=NOT/REAL');
    expect(none.body.cards).toEqual([]);
    expect((await app.get('/signals?status=SIDEWAYS')).status).toBe(422);
  });
});

describe('hiding from your own list', () => {
  it('hides a trade for one subscriber only, keeps it in their history, and deletes nothing', async () => {
    const [a, b] = await Promise.all([appSubscriber(), appSubscriber()]);
    const trade = await publish();
    expect((await a.app.post('/me/hidden', { type: 'TRADE', id: trade.id })).status).toBe(200);

    const listed = (client: NativeClient) =>
      client.get('/signals?limit=50').then((r) => r.body.cards.map((c: { id: string }) => c.id));
    expect(await listed(a.app)).not.toContain(trade.id);
    expect(await listed(b.app)).toContain(trade.id);

    const history = (await a.app.get(`/trades/history?q=${trade.ref}`)).body.trades[0];
    expect(history).toMatchObject({ id: trade.id, hidden: true });
    expect((await b.app.get(`/trades/history?q=${trade.ref}`)).body.trades[0].hidden).toBe(false);
    expect((await a.app.get('/trades/history?visibility=HIDDEN')).body.trades.map((t: { id: string }) => t.id)).toEqual([trade.id]);
    expect((await a.app.get(`/trades/${trade.id}`)).body).toMatchObject({ id: trade.id, hidden: true });

    // A later update stays attached to the trade and stays out of the list until it is shown again.
    await act(trade, 'CANCEL', { comment: 'Pulled' });
    expect(await listed(a.app)).not.toContain(trade.id);
    const alerts = (await a.app.get('/notifications?limit=10')).body.items;
    expect(alerts.some((i: { tradeId: string; type: string }) => i.tradeId === trade.id && i.type === 'TRADE_CANCELLED')).toBe(true);

    expect((await a.app.req('DELETE', `/me/hidden/TRADE/${trade.id}`)).status).toBe(200);
    expect(await listed(a.app)).toContain(trade.id);
    const kept = await withDb((db) => db.query('SELECT count(*)::int AS n FROM trades WHERE id = $1', [trade.id]));
    expect(kept.rows[0].n).toBe(1);
  });

  it('refuses to hide something that does not exist, and validates the type', async () => {
    const { app } = await appSubscriber();
    expect((await app.post('/me/hidden', { type: 'TRADE', id: randomUUID() })).status).toBe(404);
    expect((await app.post('/me/hidden', { type: 'USER', id: randomUUID() })).status).toBe(422);
    expect((await app.req('DELETE', `/me/hidden/USER/${randomUUID()}`)).status).toBe(422);
  });
});

describe('notification list', () => {
  it('counts unread the same way everywhere, and marks one, one trade, or everything read', async () => {
    const { app } = await appSubscriber();
    const head = (await app.get('/feed?limit=1')).body.headSeq;
    await app.post('/notifications/read', { all: true, upToSeq: head });
    expect((await app.get('/notifications')).body.unread).toBe(0);

    const first = await publish();
    const second = await publish();
    await act(second, 'CANCEL', { comment: 'x' });
    let list = (await app.get('/notifications?limit=5')).body;
    expect(list.unread).toBe(3);
    expect((await app.get('/feed?limit=1')).body.unread).toBe(3);
    expect((await app.get('/signals?limit=1')).body.unread).toBe(3);

    const firstEvent = list.items.find((i: { tradeId: string }) => i.tradeId === first.id);
    expect(firstEvent).toMatchObject({ unread: true, path: `/trades/${first.id}`, symbol: 'XAU/USD', direction: 'BUY' });
    expect((await app.post('/notifications/read', { eventIds: [firstEvent.eventId] })).body.unread).toBe(2);
    expect((await app.post('/notifications/read', { tradeId: second.id })).body.unread).toBe(0);

    list = (await app.get('/notifications?limit=5')).body;
    expect(list.items.slice(0, 3).every((i: { unread: boolean }) => !i.unread)).toBe(true);
    expect((await app.post('/notifications/read', { eventIds: [randomUUID()] })).body.unread).toBe(0);
  });
});

describe('announcements', () => {
  const base = () => ({
    title: 'Holiday hours',
    body: 'Markets close early on Friday.',
    category: 'GENERAL',
    idempotencyKey: randomUUID(),
  });
  const board = (client: NativeClient) =>
    client.get('/announcements').then((r) => r.body.announcements.map((a: { id: string }) => a.id));

  it('keeps a draft private, publishes it once, and records the event with it', async () => {
    const { app } = await appSubscriber();
    const draft = await admin().post('/admin/announcements', { ...base(), mode: 'DRAFT' });
    expect(draft.status).toBe(201);
    expect(draft.body).toMatchObject({ status: 'DRAFT', eventId: null, allowedActions: expect.arrayContaining(['PUBLISH']) });
    expect(await board(app)).not.toContain(draft.body.id);

    const published = await admin().post(`/admin/announcements/${draft.body.id}/publish`, { expectedVersion: draft.body.version });
    expect(published.status).toBe(200);
    expect(published.body.status).toBe('PUBLISHED');
    expect(await board(app)).toContain(draft.body.id);
    const again = await admin().post(`/admin/announcements/${draft.body.id}/publish`, { expectedVersion: published.body.version });
    expect(again.status).toBe(409);
    const events = await withDb((db) =>
      db.query("SELECT count(*)::int AS n FROM signal_events WHERE type = 'ANNOUNCEMENT' AND payload->>'announcementId' = $1", [draft.body.id]),
    );
    expect(events.rows[0].n).toBe(1);
  });

  it('turns a double tap into one announcement and one alert', async () => {
    const body = base();
    const [one, two] = await Promise.all([
      admin().post('/admin/announcements', body),
      admin().post('/admin/announcements', body),
    ]);
    expect(one.body.id).toBe(two.body.id);
    expect([one.body.replayed, two.body.replayed].sort()).toEqual([false, true]);
  });

  it('publishes on schedule, and refuses a time in the past', async () => {
    const { app } = await appSubscriber();
    const past = await admin().post('/admin/announcements', {
      ...base(),
      mode: 'SCHEDULE',
      publishAt: new Date(Date.now() - 3_600_000).toISOString(),
    });
    expect(past.status).toBe(422);
    const soon = await admin().post('/admin/announcements', {
      ...base(),
      mode: 'SCHEDULE',
      publishAt: new Date(Date.now() + 1500).toISOString(),
    });
    expect(soon.body.status).toBe('SCHEDULED');
    expect(await board(app)).not.toContain(soon.body.id);
    await waitUntil(async () => (await admin().get(`/admin/announcements/${soon.body.id}`)).body.status === 'PUBLISHED', 15_000, 'scheduled publish');
    expect(await board(app)).toContain(soon.body.id);
  });

  it('edits without resending, archives, bins and restores, and only purges what was never sent', async () => {
    const { app } = await appSubscriber();
    const sent = (await admin().post('/admin/announcements', base())).body;
    const { idempotencyKey: _key, ...content } = base();
    const edited = await admin().req('PUT', `/admin/announcements/${sent.id}`, {
      ...content,
      title: 'Holiday hours (corrected)',
      expectedVersion: sent.version,
    });
    expect(edited.status).toBe(200);
    expect(edited.body.editedAt).not.toBeNull();
    const stale = await admin().req('PUT', `/admin/announcements/${sent.id}`, { ...content, expectedVersion: sent.version });
    expect(stale.status).toBe(409);
    const event = await withDb((db) => db.query('SELECT title FROM signal_events WHERE id = $1', [sent.eventId]));
    expect(event.rows[0].title).toBe('Holiday hours');

    const archived = await admin().post(`/admin/announcements/${sent.id}/archive`, { expectedVersion: edited.body.version });
    expect(await board(app)).not.toContain(sent.id);
    const restored = await admin().post(`/admin/announcements/${sent.id}/restore`, { expectedVersion: archived.body.version });
    expect(await board(app)).toContain(sent.id);
    const binned = await admin().req('DELETE', `/admin/announcements/${sent.id}`, { expectedVersion: restored.body.version });
    expect(binned.body.deleted).toBe(true);
    expect(await board(app)).not.toContain(sent.id);
    const purgeSent = await admin().post(`/admin/announcements/${sent.id}/purge`, {
      expectedVersion: binned.body.version,
      confirm: 'PERMANENTLY_DELETE',
    });
    expect(purgeSent.status).toBe(409);

    const draft = (await admin().post('/admin/announcements', { ...base(), mode: 'DRAFT' })).body;
    expect((await admin().post(`/admin/announcements/${draft.id}/purge`, { expectedVersion: draft.version })).status).toBe(422);
    const purged = await admin().post(`/admin/announcements/${draft.id}/purge`, { expectedVersion: draft.version, confirm: 'PERMANENTLY_DELETE' });
    expect(purged.status).toBe(200);
    expect((await admin().get(`/admin/announcements/${draft.id}`)).status).toBe(404);
  });

  it('changes nothing in a bulk action when the confirmed count is out of date', async () => {
    const a = (await admin().post('/admin/announcements', base())).body;
    const b = (await admin().post('/admin/announcements', { ...base(), mode: 'DRAFT' })).body;
    const refused = await admin().post('/admin/announcements/bulk', { ids: [a.id, b.id], action: 'ARCHIVE', expectedCount: 2 });
    expect(refused.status).toBe(409);
    expect((await admin().get(`/admin/announcements/${a.id}`)).body.status).toBe('PUBLISHED');
    const ok = await admin().post('/admin/announcements/bulk', { ids: [a.id], action: 'ARCHIVE', expectedCount: 1 });
    expect(ok.body.changed).toBe(1);
  });

  it('accepts only https links, forces urgent ones to priority, hides expired ones, and stays admin-only', async () => {
    const { app } = await appSubscriber();
    const bad = await admin().post('/admin/announcements', { ...base(), linkUrl: 'javascript:alert(1)' });
    expect(bad.status).toBe(422);
    const urgent = await admin().post('/admin/announcements', { ...base(), category: 'URGENT', priority: 'NORMAL' });
    expect(urgent.body.priority).toBe('PRIORITY');
    const expiring = await admin().post('/admin/announcements', {
      ...base(),
      expiresAt: new Date(Date.now() + 1000).toISOString(),
    });
    expect(await board(app)).toContain(expiring.body.id);
    await new Promise((r) => setTimeout(r, 1200));
    expect(await board(app)).not.toContain(expiring.body.id);
    expect((await app.get('/admin/announcements')).status).toBe(403);
    expect((await app.post('/admin/announcements', base())).status).toBe(403);
  });

  it('lets a subscriber dismiss an announcement for themselves only', async () => {
    const [a, b] = await Promise.all([appSubscriber(), appSubscriber()]);
    const sent = (await admin().post('/admin/announcements', base())).body;
    await a.app.post('/me/hidden', { type: 'ANNOUNCEMENT', id: sent.id });
    expect(await board(a.app)).not.toContain(sent.id);
    expect(await board(b.app)).toContain(sent.id);
  });

  it('still accepts the original one-field form', async () => {
    const res = await admin().post('/admin/announcements', { message: 'Closed Friday.', idempotencyKey: randomUUID() });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'PUBLISHED', body: 'Closed Friday.' });
    expect(res.body.eventId).toEqual(expect.any(String));
  });

  it('serves the seeded templates and lets an administrator add one', async () => {
    const list = await admin().get('/admin/announcement-templates');
    expect(list.body.templates.length).toBeGreaterThanOrEqual(6);
    const created = await admin().post('/admin/announcement-templates', {
      name: `Weekly outlook ${randomUUID().slice(0, 6)}`,
      category: 'MARKET_UPDATE',
      title: 'Weekly outlook',
      body: '[What to watch this week]',
    });
    expect(created.status).toBe(201);
  });
});

describe('administrative archive', () => {
  it('moves only finished trades out of the Signals list, keeps them in history, and restores them', async () => {
    const { app } = await appSubscriber();
    const live = await publish();
    const refused = await admin().post('/admin/trade-archive', { tradeIds: [live.id], expectedCount: 1 });
    expect(refused.status).toBe(409);

    const done = await cancelled();
    const res = await admin().post('/admin/trade-archive', { tradeIds: [done.id], expectedCount: 1, reason: 'Tidy up' });
    expect(res.body.archived).toBe(1);
    const ids = (await app.get('/signals?limit=50')).body.cards.map((c: { id: string }) => c.id);
    expect(ids).not.toContain(done.id);
    expect(ids).toContain(live.id);
    expect((await app.get(`/trades/${done.id}`)).body.archived).toBe(true);
    expect((await admin().get('/admin/trades?archived=ARCHIVED&pageSize=100')).body.trades.map((t: { id: string }) => t.id)).toContain(done.id);

    expect((await admin().post('/admin/trade-archive/restore', { tradeIds: [done.id] })).body.restored).toBe(1);
    expect((await app.get('/signals?limit=50')).body.cards.map((c: { id: string }) => c.id)).toContain(done.id);
    const events = await withDb((db) => db.query('SELECT count(*)::int AS n FROM signal_events WHERE trade_id = $1', [done.id]));
    expect(events.rows[0].n).toBe(2);
  });

  it('archives everything finished before a date only when the confirmed count is current', async () => {
    await cancelled();
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const preview = (await admin().get(`/admin/trade-archive/preview?before=${tomorrow}`)).body.count;
    expect(preview).toBeGreaterThan(0);
    const wrong = await admin().post('/admin/trade-archive/before', { before: tomorrow, expectedCount: preview + 1 });
    expect(wrong.status).toBe(409);
    const ok = await admin().post('/admin/trade-archive/before', { before: tomorrow, expectedCount: preview });
    expect(ok.body.archived).toBe(preview);
    expect((await admin().get(`/admin/trade-archive/preview?before=${tomorrow}`)).body.count).toBe(0);
    const logged = await audit('TRADES_ARCHIVED');
    expect(logged[0]?.metadata).toMatchObject({ mode: 'BEFORE', count: preview });
  });

  it('is an administrator tool only', async () => {
    const { app } = await appSubscriber();
    expect((await app.post('/admin/trade-archive', { tradeIds: [randomUUID()], expectedCount: 1 })).status).toBe(403);
  });
});

describe('instruments', () => {
  const spec = (symbol: string) => ({
    symbol,
    displayName: `Test ${symbol}`,
    assetClass: 'COMMODITY',
    quoteCurrency: 'USD',
    pricePrecision: 2,
    tickSize: '0.01',
    pointSize: '1',
    defaultTargetPoints: '10',
    defaultStopPoints: '10',
    unitLabel: 'oz',
    exchange: 'COMEX',
  });

  it('archives without touching history, drops unused ones from filters, and blocks new signals', async () => {
    const symbol = `T${randomBytes(3).toString('hex').toUpperCase()}`;
    const created = await admin().post('/admin/instruments', spec(symbol));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ exchange: 'COMEX', archivedAt: null, tradeCount: 0 });
    const symbols = async () => (await admin().get('/instruments/symbols')).body.symbols.map((s: { symbol: string }) => s.symbol);
    expect(await symbols()).toContain(symbol);

    const archived = await admin().post(`/admin/instruments/${created.body.id}/archive`);
    expect(archived.body).toMatchObject({ active: false, archivedAt: expect.any(String) });
    expect(await symbols()).not.toContain(symbol);
    const blocked = await admin().post('/admin/signals', {
      instrumentId: created.body.id,
      direction: 'BUY',
      entryType: 'SINGLE',
      entryLow: '100',
      entryHigh: '100',
      targets: ['110'],
      stopLoss: '90',
      idempotencyKey: randomUUID(),
    });
    expect(blocked.body.error.code).toBe('INSTRUMENT_INACTIVE');
    const switchOn = await admin().req('PUT', `/admin/instruments/${created.body.id}`, { ...spec(symbol), active: true });
    expect(switchOn.status).toBe(409);
    const restored = await admin().post(`/admin/instruments/${created.body.id}/restore`);
    expect(restored.body).toMatchObject({ archivedAt: null, active: false });
  });

  it('keeps an archived instrument that has trades in the filters, marked as archived', async () => {
    const gold = await instrumentId('XAU/USD');
    const list = (await admin().get('/admin/instruments')).body.instruments;
    expect(list.find((i: { id: string }) => i.id === gold).tradeCount).toBeGreaterThan(0);
  });
});

describe('notification metadata and timing', () => {
  it('marks actionable alerts time-sensitive, routine ones active, and announcements passive, with ordering data', async () => {
    const { app } = await appSubscriber();
    const token = expoToken();
    expect((await app.post('/push/devices', { token, platform: 'ios' })).status).toBe(201);
    const trade = await publish();
    await act(trade, 'MODIFY_TARGETS', { targets: [String(Number(trade.entryLow) + 160)] });
    await admin().post('/admin/announcements', { ...{ title: 'Note', body: 'Read this.', category: 'GENERAL' }, idempotencyKey: randomUUID() });
    const [signal, update, note] = await expoFor(token, 3);
    expect(signal?.message).toMatchObject({
      interruptionLevel: 'time-sensitive',
      priority: 'high',
      threadId: trade.id,
      badge: expect.any(Number),
      data: {
        tradeId: trade.id,
        seq: trade.events[0].seq,
        tradeVersion: trade.events[0].tradeVersion,
        category: 'NEW_SIGNAL',
      },
    });
    expect(update?.message).toMatchObject({ interruptionLevel: 'active', channelId: 'updates' });
    expect(update?.message.data.seq).toBeGreaterThan(signal?.message.data.seq);
    expect(note?.message).toMatchObject({ interruptionLevel: 'passive', channelId: 'announcements', data: { path: '/news' } });
  });

  it('records an open on this device, marks it read, and reports measured timings', async () => {
    const { app } = await appSubscriber();
    const token = expoToken();
    await app.post('/push/devices', { token, platform: 'android' });
    const trade = await publish();
    await expoFor(token);
    await waitUntil(async () => {
      const rows = await withDb((db) =>
        db.query("SELECT count(*)::int AS n FROM push_deliveries WHERE event_id = $1 AND status = 'ACCEPTED'", [trade.events[0].id]),
      );
      return rows.rows[0].n > 0;
    });
    const opened = await app.post('/push/opened', { eventId: trade.events[0].id });
    expect(opened.body.recorded).toBe(true);
    expect((await app.post('/push/opened', { eventId: trade.events[0].id })).body.recorded).toBe(false);
    const item = (await app.get('/notifications?limit=20')).body.items.find((i: { eventId: string }) => i.eventId === trade.events[0].id);
    expect(item.unread).toBe(false);

    const health = (await admin().get('/admin/notifications/health')).body;
    expect(health.timings.providerAcceptance.samples).toBeGreaterThan(0);
    expect(health.timings.providerAcceptance.p95Ms).toEqual(expect.any(Number));
    expect(health.timings.opened.opens).toBeGreaterThan(0);
    expect(health.timings.queue.samples).toBeGreaterThan(0);
    expect(Array.isArray(health.alerts)).toBe(true);
  });
});

describe('small subscriber settings', () => {
  it('remembers that the tour was done, once', async () => {
    const { app } = await appSubscriber();
    expect((await app.get('/auth/me')).body.onboardedAt).toBeNull();
    const first = (await app.post('/me/onboarding')).body.onboardedAt;
    expect(first).toEqual(expect.any(String));
    expect((await app.post('/me/onboarding')).body.onboardedAt).toBe(first);
    expect((await app.get('/auth/me')).body.onboardedAt).toBe(first);
  });

  it('records an observed screen capture in the audit log, and caps a flood', async () => {
    const { app, id } = await appSubscriber();
    expect((await app.post('/me/security-events', { type: 'SCREENSHOT', screen: 'trade' })).body.recorded).toBe(true);
    expect((await audit('SCREENSHOT_DETECTED', id))[0]?.metadata).toEqual({ screen: 'trade' });
    expect((await app.post('/me/security-events', { type: 'PHOTO' })).status).toBe(422);
    for (let i = 0; i < 35; i += 1) await app.post('/me/security-events', { type: 'SCREENSHOT' });
    expect((await audit('SCREENSHOT_DETECTED', id)).length).toBe(30);
  });

  it('serves everything here only to a signed-in subscriber with access', async () => {
    const anonymous = new NativeClient();
    for (const path of ['/signals', '/notifications', '/announcements', '/me/device']) {
      expect((await anonymous.get(path)).status).toBe(401);
    }
    expect(ctx().api).toContain('/api/v1');
  });
});
