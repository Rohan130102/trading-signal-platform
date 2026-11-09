import { randomBytes, randomUUID } from 'node:crypto';
import { generate } from 'otplib';
import { afterAll, describe, expect, it, onTestFinished } from 'vitest';
import {
  act,
  activeTrade,
  admin,
  Client,
  control,
  ctx,
  LiveClient,
  newSubscriber,
  PASSWORD,
  publish,
  signalBody,
  uniqueId,
  waitUntil,
  withDb,
} from './helpers.js';
import { NativeClient } from './native.js';

/* Master Admin, platform rules, Awaiting Entry, trailing wording, removing trades from subscriber screens,
 * per-subscriber history and screenshot permission. */

/** Registers an administrator through the Master Admin and takes them through first sign-in, as a person would. */
async function newAdmin() {
  const loginId = uniqueId('adm');
  const created = await admin().post('/admin/admins', { name: 'Desk Admin', loginId, idempotencyKey: randomUUID() });
  expect(created.status).toBe(201);
  const client = new Client();
  const temp = created.body.temporaryPassword as string;
  expect((await client.post('/auth/login', { identifier: loginId, password: temp })).status).toBe(200);
  expect((await client.post('/auth/change-password', { currentPassword: temp, newPassword: PASSWORD })).status).toBe(
    200,
  );
  const setup = await client.post('/auth/mfa/setup', {});
  const enabled = await client.post('/auth/mfa/enable', { code: await generate({ secret: setup.body.secret }) });
  expect(enabled.status).toBe(200);
  expect((await client.get('/auth/me')).body.next).toBeNull();
  return { client, id: created.body.admin.id as string, loginId };
}

type Settings = Record<string, unknown>;
async function settings(): Promise<Settings> {
  const { id: _i, updatedAt: _u, dataResetAt: _r, ...fields } = (await admin().get('/admin/settings')).body;
  return fields;
}
async function setRules(changes: Settings) {
  const res = await admin().req('PUT', '/admin/settings', { ...(await settings()), ...changes });
  expect(res.status).toBe(200);
  return res;
}

const DEFAULT_RULES = {
  signalStartMode: 'AWAITING_ENTRY',
  entryExpiryMinutesDefault: 240,
  trailingStopWording: 'GENERAL',
  screenshotsAllowedDefault: false,
  historyScope: 'MEMBERSHIP',
};
// Every other test file relies on the defaults.
afterAll(async () => {
  await setRules(DEFAULT_RULES);
});

async function closedTrade() {
  const trade = await activeTrade();
  const res = await act(trade, 'CLOSE', {
    exitPrice: trade.stopLoss,
    basis: 'HYPOTHETICAL_OUTCOME',
    reason: 'STOP_LOSS_HIT',
    confirm: true,
  });
  expect(res.status).toBe(201);
  return res.body.trade as { id: string; ref: string; version: number; status: string };
}

const removeBody = (ids: string[], extra: Record<string, unknown> = {}) => ({
  tradeIds: ids,
  expectedCount: ids.length,
  reason: 'Published by mistake during testing',
  confirm: 'REMOVE',
  ...extra,
});

describe('Master Admin', () => {
  it('is the first administrator, and says so', async () => {
    expect((await admin().get('/auth/me')).body.isMasterAdmin).toBe(true);
  });

  it('registers administrators, who can run the desk but cannot manage administrators or platform rules', async () => {
    const { client, id } = await newAdmin();
    const me = (await client.get('/auth/me')).body;
    expect(me).toMatchObject({ role: 'ADMIN', isMasterAdmin: false });

    // The desk works.
    const published = await client.post('/admin/signals', await signalBody());
    expect(published.status).toBe(201);
    expect((await client.get('/admin/settings')).status).toBe(200);

    // Master Admin territory does not.
    const denied = [
      await client.get('/admin/admins'),
      await client.post('/admin/admins', { name: 'X', loginId: uniqueId('adm'), idempotencyKey: randomUUID() }),
      await client.req('PUT', '/admin/settings', await settings()),
      await client.post('/admin/trade-removals', removeBody([published.body.trade.id])),
      await client.post('/admin/trade-removals/restore', { tradeIds: [published.body.trade.id] }),
      await client.req('PUT', `/admin/subscribers/${(await newSubscriber()).id}/screenshots`, {
        screenshotsAllowed: true,
      }),
      await client.post(`/admin/admins/${id}/master`, { isMasterAdmin: true }),
    ];
    for (const res of denied) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('MASTER_ADMIN_REQUIRED');
    }
    const list = await admin().get('/admin/admins');
    const row = list.body.admins.find((a: { id: string }) => a.id === id);
    expect(row).toMatchObject({ isMasterAdmin: false, mfaEnabled: true, status: 'ACTIVE', createdBy: 'Root Admin' });
  });

  it('a repeated registration returns the same administrator once, and a taken login is refused', async () => {
    const loginId = uniqueId('adm');
    const body = { name: 'Twice', loginId, idempotencyKey: randomUUID() };
    const first = await admin().post('/admin/admins', body);
    const second = await admin().post('/admin/admins', body);
    expect(second.body.admin.id).toBe(first.body.admin.id);
    expect(second.body.temporaryPassword).toBeNull();
    const taken = await admin().post('/admin/admins', { ...body, idempotencyKey: randomUUID() });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('LOGIN_ID_TAKEN');
  });

  it('there is always a Master Admin, and nobody suspends themself', async () => {
    const rootId = ctx().adminId;
    const demote = await admin().post(`/admin/admins/${rootId}/master`, { isMasterAdmin: false });
    expect(demote.status).toBe(409);
    expect(demote.body.error.code).toBe('LAST_MASTER_ADMIN');
    const self = await admin().post(`/admin/admins/${rootId}/status`, { status: 'SUSPENDED' });
    expect(self.status).toBe(422);

    // With a second Master Admin, one can be removed again.
    const { id } = await newAdmin();
    expect((await admin().post(`/admin/admins/${id}/master`, { isMasterAdmin: true })).body.isMasterAdmin).toBe(true);
    expect((await admin().post(`/admin/admins/${id}/master`, { isMasterAdmin: false })).body.isMasterAdmin).toBe(false);
  });

  it('suspending signs the administrator out everywhere; a reset issues a new temporary password', async () => {
    const { client, id, loginId } = await newAdmin();
    const suspended = await admin().post(`/admin/admins/${id}/status`, { status: 'SUSPENDED', note: 'Left' });
    expect(suspended.body.status).toBe('SUSPENDED');
    expect((await client.get('/auth/me')).status).toBe(401);
    await admin().post(`/admin/admins/${id}/status`, { status: 'ACTIVE' });

    const reset = await admin().post(`/admin/admins/${id}/reset`, {});
    expect(reset.status).toBe(200);
    const fresh = new Client();
    const login = await fresh.post('/auth/login', { identifier: loginId, password: reset.body.temporaryPassword });
    expect(login.status).toBe(200);
    expect((await fresh.get('/auth/me')).body.next).toBe('CHANGE_PASSWORD');

    const actions = await withDb(async (db) =>
      (await db.query('SELECT action FROM audit_logs WHERE target_id = $1 ORDER BY id', [id])).rows.map(
        (r: { action: string }) => r.action,
      ),
    );
    expect(actions).toEqual(
      expect.arrayContaining(['ADMIN_CREATED', 'ADMIN_SUSPENDED', 'ADMIN_REACTIVATED', 'ADMIN_ACCESS_RESET']),
    );
  });
});

describe('platform rules', () => {
  it('decide how a signal starts, with the change audited from and to', async () => {
    await setRules({ signalStartMode: 'ACTIVE' });
    const { activateOnPublish: _flag, ...body } = await signalBody();
    const res = await admin().post('/admin/signals', body);
    expect(res.body.trade.status).toBe('ACTIVE');
    expect(res.body.trade.entryExpiresAt).toBeNull();
    const log = await admin().get('/admin/audit?action=SETTINGS_UPDATED');
    expect(log.body.entries[0].metadata.rules.signalStartMode).toEqual({ from: 'AWAITING_ENTRY', to: 'ACTIVE' });
    await setRules({ signalStartMode: 'AWAITING_ENTRY' });
  });

  it('refuse an entry window too short to act on', async () => {
    const res = await admin().req('PUT', '/admin/settings', { ...(await settings()), entryExpiryMinutesDefault: 3 });
    expect(res.status).toBe(422);
  });
});

describe('Awaiting Entry', () => {
  it('a signal that never becomes active is cancelled automatically, once, and subscribers are told', async () => {
    const created = await newSubscriber(30);
    const app = new NativeClient(null);
    expect((await app.login(created.loginId, PASSWORD)).status).toBe(200);
    const token = `ExponentPushToken[ok${randomBytes(10).toString('hex')}]`;
    expect((await app.post('/push/devices', { token, platform: 'android' })).status).toBe(201);

    const trade = await publish({ entryExpiresAt: new Date(Date.now() + 60_000).toISOString() });
    expect(trade.status).toBe('PUBLISHED');
    await withDb((db) =>
      db.query("UPDATE trades SET entry_expires_at = now() - interval '1 second' WHERE id = $1", [trade.id]),
    );
    const expired = await waitUntil(
      async () => {
        const detail = (await admin().get(`/admin/trades/${trade.id}`)).body;
        return detail.status === 'EXPIRED' ? detail : false;
      },
      25_000,
      'automatic expiry',
    );
    expect(expired.events.filter((e: { type: string }) => e.type === 'ENTRY_EXPIRED')).toHaveLength(1);

    // The new signal and its cancellation both reach the phone.
    const sent = await waitUntil(
      async () => {
        const log = (await control('/expo-log')) as { message: Record<string, any> }[];
        const mine = log.filter((e) => e.message.to === token);
        return mine.length >= 2 ? mine : false;
      },
      15_000,
      'two pushes',
    );
    expect(sent.map((e) => e.message.data.category)).toEqual(['NEW_SIGNAL', 'CLOSURE']);
    expect(sent[1]?.message.body).toMatch(/expired before the entry was reached/i);
  });
});

describe('trailing stop wording', () => {
  it('is general by default: the new stop without the distance arithmetic', async () => {
    const trade = await activeTrade();
    const entry = Number(trade.entryLow);
    const res = await act(trade, 'TRAIL_STOP', { referencePrice: String(entry + 150), trailPoints: '20' });
    expect(res.status).toBe(201);
    const event = res.body.trade.events.at(-1);
    expect(event.title).toMatch(/^Trail stop-loss to /);
    expect(event.body).toMatch(/^Trail the stop-loss on trade T-\d+ to /);
    expect(`${event.title} ${event.body}`).not.toMatch(/pts|points/i);
  });

  it('states the distance when asked, and accepts a plain new stop', async () => {
    let trade = await activeTrade();
    const entry = Number(trade.entryLow);
    const detailed = await act(trade, 'TRAIL_STOP', {
      referencePrice: String(entry + 150),
      trailPoints: '20',
      wording: 'DETAILED',
    });
    expect(detailed.body.trade.events.at(-1).body).toMatch(/pts from/);
    trade = detailed.body.trade;

    const byPrice = await act(trade, 'TRAIL_STOP', { price: String(entry + 140) });
    expect(byPrice.status).toBe(201);
    expect(Number(byPrice.body.trade.stopLoss)).toBe(entry + 140);
    expect(byPrice.body.trade.events.at(-1).body).not.toMatch(/pts/);

    const both = await act(byPrice.body.trade, 'TRAIL_STOP', {
      price: String(entry + 145),
      referencePrice: String(entry + 160),
      trailPoints: '10',
    });
    expect(both.status).toBe(422);
  });
});

describe('removing trades from subscriber screens', () => {
  it('is all or nothing, needs a reason and the typed confirmation, and never applies to live trades', async () => {
    const closed = await closedTrade();
    const live = await activeTrade();
    const withLive = await admin().post('/admin/trade-removals', removeBody([closed.id, live.id]));
    expect(withLive.status).toBe(409);
    expect(withLive.body.error.message).toMatch(/still live/);
    expect((await admin().post('/admin/trade-removals', removeBody([closed.id], { confirm: 'yes' }))).status).toBe(422);
    expect((await admin().post('/admin/trade-removals', removeBody([closed.id], { reason: 'x' }))).status).toBe(422);
    expect((await admin().post('/admin/trade-removals', removeBody([closed.id], { expectedCount: 2 }))).status).toBe(
      409,
    );
    expect((await admin().get(`/admin/trades/${closed.id}`)).body.removal).toBeNull();
  });

  it('takes a trade off every subscriber screen, keeps it for administrators and in every figure', async () => {
    const sub = await newSubscriber(30);
    const closed = await closedTrade();
    const before = (await admin().get('/admin/performance')).body;
    expect((await sub.client.get('/trades/history?pageSize=100')).body.trades.map((t: any) => t.id)).toContain(
      closed.id,
    );
    const live = await LiveClient.connect(sub.client.cookie);
    live.hello(0);
    onTestFinished(() => live.close());

    const removed = await admin().post('/admin/trade-removals', removeBody([closed.id]));
    expect(removed.body).toEqual({ removed: 1 });
    await waitUntil(() => live.messages.find((m) => m.type === 'refresh'), 8000, 'refresh notice');

    // Gone for the subscriber: lists, the trade page, alerts and the unread count.
    expect((await sub.client.get('/trades/history?pageSize=100')).body.trades.map((t: any) => t.id)).not.toContain(
      closed.id,
    );
    const cards = (await sub.client.get('/signals?status=ALL&limit=50')).body.cards;
    expect(cards.map((c: { id: string }) => c.id)).not.toContain(closed.id);
    expect((await sub.client.get(`/trades/${closed.id}`)).status).toBe(404);
    const alerts = (await sub.client.get('/notifications?limit=50')).body.items;
    expect(alerts.map((a: { tradeId: string }) => a.tradeId)).not.toContain(closed.id);

    // Still there for administrators, frozen, and counted exactly as before.
    const detail = (await admin().get(`/admin/trades/${closed.id}`)).body;
    expect(detail.removal).toMatchObject({ removedBy: 'Root Admin', reason: 'Published by mistake during testing' });
    expect(detail.allowedActions).toEqual([]);
    const listed = (await admin().get('/admin/trades?removed=REMOVED&pageSize=100')).body.trades;
    expect(listed.find((t: { id: string }) => t.id === closed.id)?.removedAt).toEqual(expect.any(String));
    const after = (await admin().get('/admin/performance')).body;
    expect(after.lifecycle.losses).toBe(before.lifecycle.losses);
    expect(after.removedFromScreens).toBe(before.removedFromScreens + 1);
    const correct = await act(detail, 'CORRECT', { reason: 'Should not alert anyone', exitPrice: '1' });
    expect(correct.status).toBe(409);
    expect(correct.body.error.code).toBe('TRADE_REMOVED');

    // The audit entry names the trade and its losing outcome.
    const entry = (await admin().get('/admin/audit?action=TRADES_REMOVED_FROM_SCREENS')).body.entries[0];
    expect(entry.metadata.trades).toEqual([
      expect.objectContaining({ id: closed.id, ref: closed.ref, status: 'CLOSED', outcome: 'LOSS' }),
    ]);

    // And it comes back.
    expect((await admin().post('/admin/trade-removals/restore', { tradeIds: [closed.id] })).body).toEqual({
      restored: 1,
    });
    expect((await sub.client.get(`/trades/${closed.id}`)).status).toBe(200);
  });
});

describe('each subscriber’s own history', () => {
  it('starts with their membership, except live trades; the ALL scope shows everything', async () => {
    const earlier = await closedTrade();
    const stillLive = await activeTrade();
    const sub = await newSubscriber(30);
    const ids = async () =>
      (await sub.client.get('/trades/history?pageSize=100')).body.trades.map((t: { id: string }) => t.id);

    expect(await ids()).not.toContain(earlier.id);
    expect(await ids()).toContain(stillLive.id);
    expect((await sub.client.get(`/trades/${earlier.id}`)).status).toBe(404);
    const alerts = (await sub.client.get('/notifications?limit=50')).body;
    expect(alerts.items).toHaveLength(0);
    expect(alerts.unread).toBe(0);

    await setRules({ historyScope: 'ALL' });
    expect(await ids()).toContain(earlier.id);
    await setRules({ historyScope: 'MEMBERSHIP' });
  });

  it('can be cleared by the subscriber alone, leaving live trades and everyone else untouched', async () => {
    const a = await newSubscriber(30);
    const b = await newSubscriber(30);
    const finished = await closedTrade();
    const live = await activeTrade();

    const cleared = await a.client.post('/me/history/clear', { confirm: true });
    expect(cleared.body.cleared).toBeGreaterThanOrEqual(1);
    const aView = (await a.client.get('/trades/history?pageSize=100')).body.trades;
    expect(aView.find((t: { id: string }) => t.id === finished.id)?.hidden).toBe(true);
    const aShown = (await a.client.get('/trades/history?pageSize=100&visibility=SHOWN')).body.trades;
    expect(aShown.map((t: { id: string }) => t.id)).not.toContain(finished.id);
    expect(aShown.map((t: { id: string }) => t.id)).toContain(live.id);
    const aCards = (await a.client.get('/signals?status=ALL&limit=50')).body.cards.map((c: { id: string }) => c.id);
    expect(aCards).not.toContain(finished.id);
    expect(aCards).toContain(live.id);
    const bCards = (await b.client.get('/signals?status=ALL&limit=50')).body.cards.map((c: { id: string }) => c.id);
    expect(bCards).toContain(finished.id);

    expect((await a.client.post('/me/history/restore', {})).body.restored).toBeGreaterThanOrEqual(1);
    const restored = (await a.client.get('/signals?status=ALL&limit=50')).body.cards.map((c: { id: string }) => c.id);
    expect(restored).toContain(finished.id);
  });
});

describe('screenshot permission', () => {
  it('is blocked by default, can be allowed per subscriber or for everyone, and only by the Master Admin', async () => {
    const sub = await newSubscriber(30);
    const allowed = async () => (await sub.client.get('/auth/me')).body.security.screenshotsAllowed;
    expect(await allowed()).toBe(false);

    const set = await admin().req('PUT', `/admin/subscribers/${sub.id}/screenshots`, { screenshotsAllowed: true });
    expect(set.body).toMatchObject({ screenshotsAllowed: true, screenshotsEffective: true });
    expect(await allowed()).toBe(true);

    await admin().req('PUT', `/admin/subscribers/${sub.id}/screenshots`, { screenshotsAllowed: null });
    expect(await allowed()).toBe(false);
    await setRules({ screenshotsAllowedDefault: true });
    expect(await allowed()).toBe(true);
    await setRules({ screenshotsAllowedDefault: false });

    const audit = (await admin().get(`/admin/audit?targetId=${sub.id}`)).body.entries.map(
      (e: { action: string }) => e.action,
    );
    expect(audit).toContain('SUBSCRIBER_SCREENSHOT_PERMISSION_SET');
  });
});

describe('public results page', () => {
  it('shows times and definitions, counts removed trades, and never filters figures by outcome', async () => {
    const closed = await closedTrade();
    await admin().post('/admin/trade-removals', removeBody([closed.id]));
    onTestFinished(async () => {
      await admin().post('/admin/trade-removals/restore', { tradeIds: [closed.id] });
    });
    const approval = await admin().post('/admin/compliance/public-performance/approvals', {
      jurisdiction: 'Test jurisdiction',
      scope: 'Automated test only',
      reviewerName: 'Test Reviewer',
      documentReference: 'TEST-DOC-2',
      effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    onTestFinished(async () => {
      await admin().post(`/admin/compliance/public-performance/approvals/${approval.body.id}/revoke`);
    });
    const gated = new Client(null, ctx().gatedApi);
    const all = (await gated.get('/public/performance')).body;
    const record = all.records.find((r: { ref: string }) => r.ref === closed.ref);
    expect(record).toMatchObject({
      status: 'CLOSED',
      outcome: 'LOSS',
      publishedAt: expect.any(String),
      activatedAt: expect.any(String),
      exitedAt: expect.any(String),
    });
    expect(all.removedFromScreens).toBeGreaterThanOrEqual(1);
    expect(all.methodology.definitions.map((d: { term: string }) => d.term)).toEqual(
      expect.arrayContaining(['Published', 'Activated', 'Exit', 'Win rate']),
    );

    const wins = (await gated.get('/public/performance?outcome=WIN')).body;
    expect(wins.records.every((r: { outcome: string }) => r.outcome === 'WIN')).toBe(true);
    expect(wins.lifecycle).toEqual(all.lifecycle);

    const info = (await new Client().get('/public/info')).body;
    expect(info).toHaveProperty('aboutBody');
    expect(info).toHaveProperty('dataResetAt');
  });
});
