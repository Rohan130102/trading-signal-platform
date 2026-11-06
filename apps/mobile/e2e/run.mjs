// End-to-end journeys on a real Android emulator, against a real API, worker and database.
//
//   node apps/mobile/e2e/stack.mjs                  (leave running)
//   adb reverse tcp:4200 tcp:4200; adb reverse tcp:8081 tcp:8081
//   EXPO_PUBLIC_API_URL=http://localhost:4200 npx expo start --localhost
//   node apps/mobile/e2e/run.mjs [journey names]
//
// The app is used as a person would use it. The API is called directly only to play the other party:
// the administrator publishing while a subscriber watches, for example.
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { delay, Device } from './driver.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(resolve(here, '../../api'), 'package.json'));
const { generate } = await import(require.resolve('otplib'));
const state = JSON.parse(readFileSync(join(here, '.state.json'), 'utf8'));
const API = `http://localhost:${state.apiPort}/api/v1`;
const PACKAGE = process.env.APP_PACKAGE ?? 'host.exp.exponent';
const APP_URL =
  process.env.APP_URL ??
  'exp://127.0.0.1:8081?__expo_disable_fab=1&__expo_disable_auto_launch=1&__expo_disable_onboarding=1';
const LINK_BASE = process.env.APP_LINK_BASE ?? 'exp://127.0.0.1:8081/--';

const d = new Device();
const results = [];

async function server(method, path, body, token = state.adminToken) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
  return parsed;
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Some labels are drawn in capitals by the platform, so wording is matched without regard to case.
const expectText = async (pattern, timeout = 15_000) =>
  d.waitFor({ any: pattern instanceof RegExp ? pattern : new RegExp(escapeRe(pattern), 'i') }, timeout);
const network = async (what) => fetch(`http://localhost:${state.controlPort}/network/${what}`);
/** How many feed cards mention this, whatever else on screen repeats the figure. */
const cardCount = async (text) =>
  (await d.nodes()).filter((n) => n.id.startsWith('feed-card-') && n.desc.includes(text)).length;

let instrumentIds = null;
async function instrument(symbol = 'XAU/USD') {
  instrumentIds ??= Object.fromEntries(
    (await server('GET', '/admin/instruments')).instruments.map((i) => [i.symbol, i.id]),
  );
  return instrumentIds[symbol];
}

let nextEntry = 3000;
async function publish({ direction = 'BUY', symbol = 'XAU/USD', entry, ...rest } = {}) {
  nextEntry += 10;
  const price = String(entry ?? nextEntry);
  const up = direction === 'BUY';
  const result = await server('POST', '/admin/signals', {
    instrumentId: await instrument(symbol),
    direction,
    entryType: 'SINGLE',
    entryLow: price,
    entryHigh: price,
    targets: [String(Number(price) + (up ? 150 : -150))],
    stopLoss: String(Number(price) + (up ? -180 : 180)),
    idempotencyKey: randomUUID(),
    confirmDuplicate: true,
    ...rest,
  });
  return result.trade;
}

async function act(trade, action, body = {}) {
  const current = await server('GET', `/admin/trades/${trade.id}`);
  const result = await server('POST', `/admin/trades/${trade.id}/events`, {
    action,
    expectedVersion: current.version,
    idempotencyKey: randomUUID(),
    ...body,
  });
  return result.trade;
}

async function launch() {
  await d.shell('am', 'force-stop', PACKAGE);
  await delay(400);
  await d.shell('am', 'start', '-a', 'android.intent.action.VIEW', '-d', `'${APP_URL}'`, PACKAGE);
}

async function signOutIfNeeded() {
  await launch();
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const nodes = await d.nodes();
    const has = (id) => nodes.some((n) => n.id.endsWith(id) || n.id === id);
    if (has('login-id')) return;
    if (has('tab-account')) {
      await d.tap({ id: 'tab-account' });
      await d.scrollTo({ id: 'sign-out' }, { maxSwipes: 15 });
      await d.tap({ id: 'sign-out' });
      await d.waitFor({ id: 'login-id' }, 15_000);
      return;
    }
    if (has('tab-more')) {
      await d.tap({ id: 'tab-more' });
      await d.tap({ id: 'more-account' });
      await d.scrollTo({ id: 'sign-out' }, { maxSwipes: 15 });
      await d.tap({ id: 'sign-out' });
      await d.waitFor({ id: 'login-id' }, 15_000);
      return;
    }
    if (nodes.some((n) => /^Sign out$/.test(n.text) || n.desc === 'Sign out')) {
      await d.tap({ any: /^Sign out$/ });
      await d.waitFor({ id: 'login-id' }, 15_000);
      return;
    }
    await delay(500);
  }
  throw new Error(`The app did not reach a known screen: ${await d.text()}`);
}

async function login(id, password) {
  await d.type({ id: 'login-id' }, id);
  await d.type({ id: 'login-password' }, password);
  await d.hideKeyboard();
  await d.tap({ id: 'login-submit' });
}

let lastStep = 0;
async function totp() {
  // A code works once. Wait for a fresh one if this window's has been spent.
  for (;;) {
    const step = Math.floor(Date.now() / 30_000);
    if (step !== lastStep) {
      lastStep = step;
      return generate({ secret: state.totpSecret });
    }
    await delay(1000);
  }
}

async function signInSubscriber() {
  await signOutIfNeeded();
  await login(state.subscriber.loginId, state.password);
  await d.waitFor({ id: 'feed-list' }, 20_000);
}

async function signInAdmin() {
  await signOutIfNeeded();
  await login('admin', state.password);
  await d.waitFor({ id: 'mfa-code' }, 20_000);
  await d.type({ id: 'mfa-code' }, await totp());
  await d.hideKeyboard();
  await d.tap({ id: 'mfa-verify' });
  await d.waitFor({ id: 'dashboard' }, 20_000);
}

const J = {};

J['sign-in-errors'] = async () => {
  await signOutIfNeeded();
  await d.screenshot('login');
  await d.hideKeyboard();
  await d.tap({ id: 'login-submit' });
  await expectText('Enter your login ID');
  await login(state.subscriber.loginId, 'definitely-wrong-password');
  const error = await d.waitFor({ id: 'form-error' });
  await d.screenshot('login-error');
  assert(error, 'A wrong password shows an error');
  const text = await d.text();
  assert(!/asha.*exists|no such user/i.test(text), 'The error must not reveal whether the account exists');
  assert(await d.has({ id: 'login-id' }), 'Still on the sign-in screen');
};

J['disclosures-before-sign-in'] = async () => {
  await signOutIfNeeded();
  await d.tap({ id: 'login-disclosures' });
  await expectText('Risk disclosure');
  await expectText(/substantial risk/);
  await d.screenshot('disclosures');
  await d.back();
  await d.waitFor({ id: 'login-id' });
};

J['first-sign-in-subscriber'] = async () => {
  const loginId = `new${Date.now().toString(36)}`;
  const { temporaryPassword } = await server('POST', '/admin/subscribers', {
    name: 'Vikram Shah',
    loginId,
    durationDays: 30,
    idempotencyKey: randomUUID(),
  });
  await signOutIfNeeded();
  await login(loginId, temporaryPassword);
  await d.waitFor({ id: 'new-password' }, 20_000);
  await d.screenshot('set-password');
  // The temporary password was typed a moment ago, so it is not asked for twice.
  assert(!(await d.has({ id: 'current-password' })), 'No retyping of the temporary password');
  await d.type({ id: 'new-password' }, 'short');
  await d.type({ id: 'new-password-again' }, 'different');
  await d.hideKeyboard();
  await d.tap({ id: 'set-password-submit' });
  await expectText('at least 10 characters');
  await d.type({ id: 'new-password' }, state.password);
  await d.type({ id: 'new-password-again' }, state.password);
  await d.hideKeyboard();
  await d.tap({ id: 'set-password-submit' });
  await d.waitFor({ id: 'feed-list' }, 20_000);
  await d.waitFor({ id: 'live-live' }, 20_000);
  await d.screenshot('first-feed');
};

J['first-sign-in-admin'] = async () => {
  await signOutIfNeeded();
  await login('newadmin', state.freshAdminTemp);
  await d.waitFor({ id: 'new-password' }, 20_000);
  await d.type({ id: 'new-password' }, state.password);
  await d.type({ id: 'new-password-again' }, state.password);
  await d.hideKeyboard();
  await d.tap({ id: 'set-password-submit' });
  await d.waitFor({ id: 'mfa-open-app' }, 20_000);
  await d.screenshot('mfa-setup');
  await d.scrollTo({ id: 'mfa-secret' });
  const secret = (await d.waitFor({ id: 'mfa-secret' })).text;
  assert(/^[A-Z2-7]{16,}$/.test(secret), `A real secret is shown, got ${secret}`);
  await d.scrollTo({ id: 'mfa-code' });
  await d.type({ id: 'mfa-code' }, await generate({ secret }));
  await d.hideKeyboard();
  await d.scrollTo({ id: 'mfa-enable' });
  await d.tap({ id: 'mfa-enable' });
  await d.waitFor({ id: 'recovery-codes' }, 15_000);
  await d.screenshot('recovery-codes');
  await d.tap({ id: 'recovery-saved' });
  await d.waitFor({ id: 'dashboard' }, 20_000);
};

J['subscriber-live-signal'] = async () => {
  await signInSubscriber();
  await d.waitFor({ id: 'live-live' }, 20_000);
  const before = Date.now();
  const trade = await publish({ direction: 'BUY', entry: 3300 });
  // No refresh, no tap: it must simply appear.
  await d.waitFor({ any: /Stop-loss/ }, 10_000);
  await expectText('New signal', 5000);
  const elapsed = Date.now() - before;
  console.warn(`  live card visible ${elapsed} ms after the publish request began (screen polling included)`);
  const text = await d.text();
  for (const expected of ['BUY', 'XAU/USD', '3,300.00', '3,120.00', '3,450.00', 'Awaiting entry']) {
    assert(text.includes(expected), `The new card shows ${expected}`);
  }
  await d.screenshot('feed-new-signal');
  await d.tap({ any: /^feed-card-/ });
  await d.waitFor({ id: 'trade-detail' });
  await expectText(/Awaiting entry|Published and awaiting/);
  await d.screenshot('trade-awaiting');

  // Updates arrive on the open screen without doing anything.
  await act(trade, 'ACTIVATE', {});
  await act(trade, 'MOVE_STOP', { price: '3200' });
  await expectText('3,200.00');
  await expectText('was 3,120.00');
  await d.screenshot('trade-stop-moved');
  await d.back();
  await d.waitFor({ id: 'feed-list' });
  await expectText(/Update to T-/);
  await expectText('3,200.00');
  await d.screenshot('feed-update');

  await d.tap({ id: 'tab-active' });
  await d.waitFor({ id: 'active-list' });
  await expectText('3,200.00');
  await d.screenshot('active');
  await d.tap({ any: /BUY XAU\/USD/ });
  await d.waitFor({ id: 'trade-detail' });
  await act(trade, 'TARGET_HIT', { targetIndex: 1 });
  await expectText('Target 1, reached');
  await act(trade, 'CLOSE', {
    exitPrice: '3450',
    basis: 'HYPOTHETICAL_OUTCOME',
    reason: 'TARGET_ACHIEVED',
    confirm: true,
  });
  await d.scrollTo({ id: 'outcome' });
  await expectText('Favourable');
  await expectText(/not what any subscriber achieved/);
  await d.screenshot('trade-closed');
  const closed = await d.text();
  assert(!/USD\b.*\d+\.\d\d (USD)/.test(closed) && !/Net result/.test(closed), 'A subscriber sees no money figures');
  await d.back();
  await d.tap({ id: 'tab-history' });
  await d.waitFor({ id: 'history-list' });
  await expectText(`history-${trade.ref}`);
  await d.screenshot('history');
  await d.type({ id: 'history-search' }, 'NOTHINGMATCHES');
  await d.hideKeyboard();
  await expectText('Nothing matches that');
  await d.type({ id: 'history-search' }, trade.ref);
  await d.hideKeyboard();
  await expectText(`history-${trade.ref}`);
  await d.tap({ id: 'tab-feed' });
};

J['subscriber-network-loss-recovery'] = async () => {
  await signInSubscriber();
  await d.waitFor({ id: 'live-live' }, 20_000);
  // The connection really is cut: the server and the proxy in front of it drop every socket.
  await network('cut');
  await d.waitFor({ id: 'connection-banner' }, 40_000);
  await expectText(/Reconnecting/);
  await d.screenshot('feed-reconnecting');
  const missed = [await publish({ entry: 3501 }), await publish({ direction: 'SELL', entry: 3502 })];
  await delay(2500);
  assert((await cardCount('3,501.00')) === 0, 'Nothing new can appear with the connection down');
  await network('restore');
  await d.waitFor({ any: /^feed-card-/, desc: /3,502\.00/ }, 60_000);
  await d.waitFor({ id: 'live-live' }, 30_000);
  await d.waitGone({ id: 'connection-banner' }, 15_000);
  assert((await cardCount('3,501.00')) === 1, 'A missed signal appears exactly once');
  assert((await cardCount('3,502.00')) === 1, 'A missed signal appears exactly once');
  const nodes = await d.nodes();
  const sell = nodes.find((n) => n.id.startsWith('feed-card-') && n.desc.includes('3,502.00'));
  const buy = nodes.find((n) => n.id.startsWith('feed-card-') && n.desc.includes('3,501.00'));
  assert(sell.y < buy.y, 'Missed signals arrive in order, newest first');
  await d.screenshot('feed-caught-up');
  for (const trade of missed) await act(trade, 'CANCEL', {});
};

J['subscriber-phone-offline'] = async () => {
  await signInSubscriber();
  await d.waitFor({ id: 'live-live' }, 20_000);
  await network('cut');
  await d.shell('svc', 'wifi', 'disable');
  await d.shell('svc', 'data', 'disable');
  await expectText('You are offline', 40_000);
  await d.screenshot('feed-offline');
  // Cached content stays readable, clearly marked as possibly out of date.
  await d.tap({ id: 'tab-active' });
  await d.waitFor({ id: 'active-list' });
  await d.tap({ id: 'tab-feed' });
  await d.shell('svc', 'wifi', 'enable');
  await d.shell('svc', 'data', 'enable');
  await network('restore');
  await d.waitFor({ id: 'live-live' }, 60_000);
};

J['subscriber-background-catch-up'] = async () => {
  await signInSubscriber();
  await d.waitFor({ id: 'live-live' }, 20_000);
  await d.shell('input', 'keyevent', 'KEYCODE_HOME');
  await delay(1500);
  const trade = await publish({ entry: 3601 });
  await delay(1000);
  await d.shell('am', 'start', '-a', 'android.intent.action.VIEW', '-d', `'${APP_URL}'`, PACKAGE);
  await d.waitFor({ any: /^feed-card-/, desc: /3,601\.00/ }, 20_000);
  assert((await cardCount('3,601.00')) === 1, 'It appears exactly once after returning');
  await act(trade, 'CANCEL', {});
};

J['subscriber-deep-link'] = async () => {
  await signInSubscriber();
  const trade = await publish({ entry: 3701 });
  await d.shell('am', 'start', '-a', 'android.intent.action.VIEW', '-d', `'${LINK_BASE}/trades/${trade.id}'`, PACKAGE);
  await d.waitFor({ id: 'trade-detail' }, 30_000);
  await expectText('3,701.00');
  await d.screenshot('deep-link');
  await act(trade, 'CANCEL', {});
  await expectText(/Cancelled\. Do not enter/);
  await d.screenshot('trade-cancelled');
};

J['subscriber-account'] = async () => {
  await signInSubscriber();
  await d.tap({ id: 'tab-account' });
  await d.waitFor({ id: 'subscription' });
  await expectText('Last valid day');
  await expectText('Days left');
  await d.screenshot('account');
  await d.waitFor({ id: 'notifications' });
  await expectText(/Expo Go cannot receive alerts|Not set up in this build|Turn on notifications/);
  await d.scrollTo({ id: 'pref-pushUpdates' });
  const before = await d.waitFor({ id: 'pref-pushUpdates' });
  // Tapping the words works, because the whole row is the target.
  const label = await d.waitFor({ text: 'Stop-loss, target and profit updates' });
  await d.tapAt(label.x, label.y);
  await delay(1000);
  const prefs = await server('GET', '/me/notification-preferences', undefined, await subscriberToken());
  assert(prefs.pushUpdates === false, 'The preference reaches the server');
  await d.screenshot('account-notifications');
  await d.tapAt(before.x, before.y);
  await d.scrollTo({ id: 'theme-light' });
  await d.tap({ id: 'theme-light' });
  await delay(500);
  await d.screenshot('account-light');
  await d.tap({ id: 'tab-feed' });
  await d.waitFor({ id: 'feed-list' });
  await d.screenshot('feed-light');
  await d.tap({ id: 'tab-account' });
  await d.scrollTo({ id: 'theme-dark' });
  await d.tap({ id: 'theme-dark' });
  await d.scrollTo({ id: 'change-password' });
  await d.tap({ id: 'change-password' });
  await d.waitFor({ id: 'change-current' });
  await d.screenshot('change-password');
  await d.tap({ id: 'sheet-close' });
  await d.waitGone({ id: 'change-current' });
};

async function subscriberToken() {
  const res = await fetch(`${API}/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: state.subscriber.loginId, password: state.password }),
  });
  return (await res.json()).token;
}

J['subscriber-expiry-and-renewal'] = async () => {
  await signInSubscriber();
  await d.waitFor({ id: 'live-live' }, 20_000);
  await server('POST', `/admin/subscribers/${state.subscriber.id}/adjust`, {
    expiresAt: new Date(Date.now() - 1000).toISOString(),
    activationDate: '2026-01-01',
    note: 'End-to-end test',
    idempotencyKey: randomUUID(),
  });
  // The open connection is closed by the server, and the app follows without being touched.
  await expectText('Your subscription has ended', 30_000);
  await d.screenshot('access-ended');
  const text = await d.text();
  assert(!/XAU\/USD|3,\d{3}\.\d\d/.test(text), 'Nothing private stays on screen');
  await server('POST', `/admin/subscribers/${state.subscriber.id}/renew`, {
    durationDays: 30,
    idempotencyKey: randomUUID(),
  });
  await d.tap({ id: 'access-check' });
  await d.waitFor({ id: 'feed-list' }, 20_000);
  await d.waitFor({ id: 'live-live' }, 20_000);
};

J['session-ended-elsewhere'] = async () => {
  await signInSubscriber();
  await server('POST', `/admin/subscribers/${state.subscriber.id}/revoke-sessions`, {});
  await d.waitFor({ id: 'login-id' }, 30_000);
  await expectText('Your session ended');
  await d.screenshot('session-ended');
};

J['admin-publish-and-manage-trade'] = async () => {
  await signInAdmin();
  await d.screenshot('dashboard');
  await d.tap({ id: 'quick-buy' });
  await d.waitFor({ id: 'compose-levels' });
  await d.waitFor({ id: 'instrument-XAU/USD' });
  await d.screenshot('compose-empty');
  await d.waitFor({ id: 'compose-review' });
  const entry = String(3800 + (Math.floor(Date.now() / 1000) % 150));
  await d.type({ id: 'entry-price' }, entry);
  await d.hideKeyboard();
  // Calculated on the phone by the shared package, before anything is sent.
  const money = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2 });
  await expectText(money(Number(entry) + 150));
  await expectText(money(Number(entry) - 180));
  await d.screenshot('compose-filled');
  await d.tap({ id: 'compose-review' });
  await d.waitFor({ id: 'compose-publish' });
  await expectText('Review before publishing');
  await expectText('Notification text');
  await d.screenshot('compose-review');
  await d.tap({ id: 'compose-publish' });
  await d.waitFor({ id: 'compose-published' }, 15_000);
  await expectText(/Handed to push services|Push queued|Sending push/);
  await d.screenshot('published');
  const page = await server('GET', '/admin/trades?live=true&pageSize=5');
  const trade = page.trades.find((t) => Number(t.entryLow) === Number(entry));
  assert(trade, 'The trade really exists on the server');
  assert(Number(trade.stopLoss) === Number(entry) - 180, 'The server agrees with the stop-loss shown');
  assert(Number(trade.targets[0].price) === Number(entry) + 150, 'The server agrees with the target shown');
  await d.tap({ id: 'published-open' });
  await d.waitFor({ id: 'admin-trade' }, 15_000);
  await d.screenshot('admin-trade');

  // Activate, with a declared fill and quantity.
  await d.tap({ id: 'do-ACTIVATE' });
  await d.waitFor({ id: 'activate-entry' });
  await d.type({ id: 'activate-entry' }, entry);
  await d.type({ id: 'activate-quantity' }, '2');
  await d.hideKeyboard();
  await d.screenshot('action-activate');
  await d.tap({ id: 'action-submit' });
  await d.waitFor({ id: 'do-MOVE_STOP' }, 15_000);
  await expectText('Active');
  await expectText(/Declared execution \(private\)/);

  // Move the stop tighter.
  const tighter = String(Number(entry) - 100);
  await d.tap({ id: 'do-MOVE_STOP' });
  await d.waitFor({ id: 'stop-price' });
  await d.type({ id: 'stop-price' }, tighter);
  await d.hideKeyboard();
  await d.screenshot('action-move-stop');
  await d.tap({ id: 'action-submit' });
  await d.waitGone({ id: 'stop-price' }, 15_000);
  await expectText(money(Number(tighter)));
  assert(
    Number((await server('GET', `/admin/trades/${trade.id}`)).stopLoss) === Number(tighter),
    'The move reached the server',
  );

  // Widening needs a second, explicit confirmation.
  const wider = String(Number(entry) - 150);
  await d.tap({ id: 'do-MOVE_STOP' });
  await d.type({ id: 'stop-price' }, wider);
  await d.hideKeyboard();
  await d.tap({ id: 'action-submit' });
  await expectText('This increases risk');
  await d.screenshot('action-widen');
  assert(
    Number((await server('GET', `/admin/trades/${trade.id}`)).stopLoss) === Number(tighter),
    'Not widened until confirmed',
  );
  await d.tap({ id: 'sheet-close' });
  await d.waitGone({ id: 'stop-price' });

  // Trail: the preview uses the same calculation the server applies.
  await d.tap({ id: 'do-TRAIL_STOP' });
  await d.type({ id: 'trail-reference' }, String(Number(entry) + 100));
  await d.type({ id: 'trail-points' }, '50');
  await d.hideKeyboard();
  await d.waitFor({ id: 'trail-result' });
  await expectText(money(Number(entry) + 50));
  await d.screenshot('action-trail');
  await d.tap({ id: 'action-submit' });
  await d.waitGone({ id: 'trail-reference' }, 15_000);
  assert(
    Number((await server('GET', `/admin/trades/${trade.id}`)).stopLoss) === Number(entry) + 50,
    'The trail reached the server at the previewed price',
  );

  // Book half.
  await d.scrollTo({ id: 'do-BOOK_PARTIAL' });
  await d.tap({ id: 'do-BOOK_PARTIAL' });
  await d.type({ id: 'exit-price' }, String(Number(entry) + 100));
  await d.hideKeyboard();
  await d.waitFor({ id: 'exit-preview' });
  await d.tap({ id: 'basis-ADMIN_DECLARED_EXECUTION' });
  await expectText('+100 pts');
  await expectText('100.00 USD');
  await d.screenshot('action-partial');
  await d.tap({ id: 'action-submit' });
  await d.waitGone({ id: 'exit-price' }, 15_000);

  // Close the rest, using the quick fill.
  await d.scrollTo({ id: 'do-CLOSE' }, { up: true });
  await d.tap({ id: 'do-CLOSE' });
  await d.waitFor({ id: 'exit-target-1' });
  await d.tap({ id: 'exit-target-1' });
  await d.screenshot('action-close');
  await d.tap({ id: 'action-submit' });
  // A destructive step asks first, in the system's own dialog.
  await d.tap({ text: /^close trade$/i }, 10_000);
  await d.waitGone({ id: 'exit-price' }, 15_000);
  await d.scrollTo({ id: 'trade-result' });
  await expectText('Net result');
  await d.screenshot('admin-trade-closed');
  const final = await server('GET', `/admin/trades/${trade.id}`);
  assert(final.status === 'CLOSED', 'The trade closed on the server');
  // 2 units, half at +100 and half at +150, multiplier 1: 100 + 150.
  assert(Number(final.aggregate.netPnl) === 250, `The result is exact, got ${final.aggregate.netPnl}`);
  await expectText('250.00 USD');
  await d.back();
};

J['admin-duplicate-guard'] = async () => {
  await signInAdmin();
  await d.tap({ id: 'quick-sell' });
  await d.waitFor({ id: 'instrument-BTC/USD' });
  await d.tap({ id: 'instrument-BTC/USD' });
  await d.type({ id: 'entry-price' }, '90000');
  await d.hideKeyboard();
  await d.tap({ id: 'compose-review' });
  await d.tap({ id: 'compose-publish' });
  await d.waitFor({ id: 'compose-published' }, 15_000);
  await d.tap({ id: 'published-another' });
  await d.waitGone({ id: 'compose-published' });
  await d.tap({ id: 'direction-SELL' });
  await d.type({ id: 'entry-price' }, '90000');
  await d.hideKeyboard();
  await d.tap({ id: 'compose-review' });
  await d.tap({ id: 'compose-publish' });
  await expectText('Possible duplicate');
  await d.screenshot('compose-duplicate');
  await d.tap({ id: 'sheet-close' });
  await d.tap({ id: 'compose-close' });
  await d.waitFor({ id: 'dashboard' });
};

J['admin-custom-levels-and-validation'] = async () => {
  await signInAdmin();
  await d.tap({ id: 'quick-buy' });
  await d.type({ id: 'entry-price' }, '3300');
  await d.hideKeyboard();
  const toggle = await d.waitFor({ id: 'compose-custom' });
  await d.tapAt(toggle.x, toggle.y);
  await d.scrollTo({ id: 'custom-stop' });
  // A stop-loss above a BUY entry is wrong, and the phone says so before anything is sent.
  await d.type({ id: 'custom-stop' }, '3400');
  await d.hideKeyboard();
  await d.waitFor({ id: 'compose-issue' });
  await d.screenshot('compose-invalid');
  const review = await d.waitFor({ id: 'compose-review' });
  await d.tapAt(review.x, review.y);
  await delay(500);
  assert(!(await d.has({ id: 'compose-publish' })), 'An invalid signal cannot reach review');
  await d.tap({ id: 'compose-close' });
  await d.waitFor({ id: 'dashboard' });
  // Work in progress comes back.
  await d.tap({ id: 'tab-new-signal' });
  await d.waitFor({ id: 'compose-custom' });
  await expectText('3400', 5000);
  await d.tap({ id: 'compose-save-draft' });
  await expectText('Draft saved');
  await d.tap({ id: 'compose-close' });
  await d.waitFor({ id: 'dashboard' });
  await d.tap({ id: 'tab-more' });
  await d.tap({ id: 'more-drafts' });
  await d.waitFor({ id: 'drafts' });
  await expectText(/entry 3300/);
  await d.screenshot('drafts');
  await d.back();
};

J['admin-subscribers'] = async () => {
  await signInAdmin();
  await d.tap({ id: 'tab-subscribers' });
  await d.waitFor({ id: 'subscribers-list' });
  await d.screenshot('subscribers');
  await d.tap({ id: 'new-subscriber' });
  await d.waitFor({ id: 'sub-name' });
  await d.tap({ id: 'subscriber-create' });
  await expectText('Enter a name');
  const login = `e2e${Date.now().toString(36)}`;
  await d.type({ id: 'sub-name' }, 'Meera Iyer');
  await d.type({ id: 'sub-login' }, login);
  await d.hideKeyboard();
  await d.tap({ id: 'duration-90' });
  await d.screenshot('subscriber-new');
  await d.tap({ id: 'subscriber-create' });
  await d.waitFor({ id: 'credentials' }, 15_000);
  const password = (await d.waitFor({ id: 'temp-password' })).text;
  assert(password.length >= 10, 'A temporary password is shown once');
  await d.screenshot('subscriber-created');
  await d.tap({ id: 'subscriber-open' });
  await d.waitFor({ id: 'subscriber-detail' });
  await expectText('Created for 90 days');
  await d.screenshot('subscriber-detail');
  const res = await fetch(`${API}/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: login, password }),
  });
  assert(res.ok, 'The password shown really works');

  await d.tap({ id: 'subscriber-renew' });
  await d.waitFor({ id: 'renew-days' });
  await d.screenshot('subscriber-renew');
  await d.tap({ id: 'renew-submit' });
  await d.waitGone({ id: 'renew-days' }, 15_000);
  await expectText(/Renewed for 30 days/);

  await d.tap({ id: 'subscriber-adjust' });
  await d.waitFor({ id: 'adjust-date' });
  await d.type({ id: 'adjust-note' }, 'Goodwill extension');
  await d.hideKeyboard();
  await d.tap({ id: 'adjust-submit' });
  await d.waitGone({ id: 'adjust-date' }, 15_000);
  await expectText('Dates adjusted');

  await d.tap({ id: 'subscriber-reset' });
  await d.tap({ id: 'reset-submit' });
  await d.waitFor({ id: 'temp-password' }, 15_000);
  await d.tap({ id: 'sheet-close' });

  await d.scrollTo({ id: 'subscriber-suspend' }, { up: true });
  await d.tap({ id: 'subscriber-suspend' });
  await d.tap({ id: 'suspend-submit' });
  await d.waitFor({ id: 'subscriber-reactivate' }, 15_000);
  await expectText('Suspended');
  await d.screenshot('subscriber-suspended');
  await d.tap({ id: 'subscriber-reactivate' });
  await d.waitFor({ id: 'subscriber-suspend' }, 15_000);
  await d.back();
};

J['admin-other-screens'] = async () => {
  await signInAdmin();
  await d.tap({ id: 'tab-trades' });
  await d.waitFor({ id: 'trades-list' });
  await d.tap({ id: 'trades-closed' });
  await d.screenshot('admin-trades');
  await d.tap({ id: 'tab-more' });
  await d.waitFor({ id: 'more' });
  await d.screenshot('more');

  await d.tap({ id: 'more-performance' });
  await d.waitFor({ id: 'performance' });
  await expectText('Internal analytics');
  await expectText('Every record');
  await d.screenshot('performance');
  await d.back();

  await d.tap({ id: 'more-health' });
  await d.waitFor({ id: 'health' });
  await expectText(/Running|Not responding/);
  const text = await d.text();
  assert(!/delivered/i.test(text.replace(/not.*delivered/i, '')), 'Acceptance is never called delivery');
  await d.screenshot('health');
  await d.back();

  await d.tap({ id: 'more-announcement' });
  await d.waitFor({ id: 'announcement' });
  await d.type({ id: 'announcement-message' }, 'Markets closed Friday.');
  await d.hideKeyboard();
  await d.screenshot('announcement');
  await d.tap({ id: 'announcement-send' });
  await d.waitFor({ id: 'more' }, 15_000);
  const feed = await server('GET', '/feed?limit=5');
  assert(
    feed.events.some((e) => e.type === 'ANNOUNCEMENT' && /Markets closed/.test(e.body + JSON.stringify(e.payload))),
    'The announcement reached the server',
  );
  await d.tap({ id: 'more-account' });
  await d.waitFor({ id: 'account' });
  await d.screenshot('admin-account');
  await d.back();
};

J['admin-blocked-from-subscriber-only-and-back'] = async () => {
  // A subscriber opening an administrator link stays out, and the server would refuse anyway.
  await signInSubscriber();
  await d.shell('am', 'start', '-a', 'android.intent.action.VIEW', '-d', `'${LINK_BASE}/compose'`, PACKAGE);
  await d.waitFor({ id: 'feed-list' }, 20_000);
  assert(!(await d.has({ id: 'compose-levels' })), 'The composer did not open');
  await d.shell('am', 'start', '-a', 'android.intent.action.VIEW', '-d', `'${LINK_BASE}/admin/performance'`, PACKAGE);
  await d.waitFor({ id: 'feed-list' }, 20_000);
  assert(!(await d.has({ id: 'performance' })), 'Performance did not open');
};

J['keyboard-keeps-buttons-reachable'] = async () => {
  // Publishing fast means the button must stay in reach while the number pad is open.
  await signInAdmin();
  const { height } = await d.size();
  const trade = await publish({ entry: 3991 });
  await d.tap({ id: 'quick-buy' });
  await d.tap({ id: 'entry-price' });
  await delay(1200);
  await d.screenshot('keyboard-compose');
  let button = await d.waitFor({ id: 'compose-review' });
  assert(button.y2 < height * 0.8, `Review stays above the keyboard, its bottom is at ${button.y2} of ${height}`);
  await d.hideKeyboard();
  await d.tap({ id: 'compose-close' });
  await d.waitFor({ id: 'dashboard' });
  await d.shell(
    'am',
    'start',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    `'${LINK_BASE}/admin/trades/${trade.id}'`,
    PACKAGE,
  );
  await d.tap({ id: 'do-MOVE_STOP' }, 30_000);
  await d.waitFor({ id: 'stop-price' });
  await delay(1200);
  await d.tap({ id: 'stop-price' });
  await delay(1200);
  await d.screenshot('keyboard-sheet');
  button = await d.waitFor({ id: 'action-submit' });
  assert(button.y2 < height * 0.8, `The action stays above the keyboard, its bottom is at ${button.y2} of ${height}`);
  await d.hideKeyboard();
  await d.tap({ id: 'sheet-close' });
  await act(trade, 'CANCEL', {});
  await d.back();
};

// Android sizes, plus Android rendering at the logical sizes of common iPhones. The second group is a layout
// check only. It is not an iOS test, and nothing here ran on iOS.
const SIZES = [
  { name: 'android-small-360x640', width: 720, height: 1280, density: 320 },
  { name: 'android-compact-360x800', width: 1080, height: 2400, density: 480 },
  { name: 'android-large-412x915', width: 1440, height: 3200, density: 560 },
  { name: 'iphone-se-size-375x667', width: 750, height: 1334, density: 320 },
  { name: 'iphone-15-size-393x852', width: 1179, height: 2556, density: 480 },
  { name: 'iphone-pro-max-size-430x932', width: 1290, height: 2796, density: 480 },
];

const problems = [];
async function capture(name) {
  await delay(600);
  await d.screenshot(name);
  for (const issue of await d.audit(40)) problems.push(`${d.prefix}/${name}: ${issue}`);
}

async function sweep(screens) {
  for (const size of SIZES) {
    d.prefix = size.name;
    await d.setSize(size.width, size.height, size.density);
    await screens();
  }
  d.prefix = '';
  await d.resetSize();
}

J['screens-subscriber-all-sizes'] = async () => {
  await signInSubscriber();
  const trade = await publish({ entry: 3811 });
  await act(trade, 'ACTIVATE', {});
  await act(trade, 'MOVE_STOP', { price: '3700' });
  await sweep(async () => {
    await d.tap({ id: 'tab-feed' });
    await d.waitFor({ id: 'feed-list' });
    await capture('feed');
    await d.tap({ any: /^feed-card-/ });
    await d.waitFor({ id: 'trade-detail' });
    await capture('trade');
    await d.back();
    await d.tap({ id: 'tab-active' });
    await d.waitFor({ id: 'active-list' });
    await capture('active');
    await d.tap({ id: 'tab-history' });
    await d.waitFor({ id: 'history-list' });
    await capture('history');
    await d.tap({ id: 'tab-account' });
    await d.waitFor({ id: 'subscription' });
    await capture('account');
  });
  await act(trade, 'CLOSE', { exitPrice: '3800', basis: 'NONE', reason: 'MANUAL', confirm: true });
  await d.tap({ id: 'tab-feed' });
  if (problems.length) throw new Error(problems.join('\n'));
};

J['screens-admin-all-sizes'] = async () => {
  await signInAdmin();
  const trade = await publish({ entry: 3911 });
  await sweep(async () => {
    await d.tap({ id: 'tab-dashboard' });
    await d.waitFor({ id: 'dashboard' });
    await capture('desk');
    await d.tap({ id: 'quick-sell' });
    await d.waitFor({ id: 'compose-levels' });
    await d.type({ id: 'entry-price' }, '3333.5');
    await d.hideKeyboard();
    await capture('compose');
    await d.tap({ id: 'compose-review' });
    await d.waitFor({ id: 'compose-publish' });
    await capture('compose-review');
    await d.tap({ id: 'sheet-close' });
    await d.waitGone({ id: 'compose-publish' });
    await d.tap({ id: 'compose-close' });
    await d.waitFor({ id: 'dashboard' });
    await d.tap({ id: 'tab-trades' });
    await d.waitFor({ id: 'trades-list' });
    await capture('trades');
    await d.tap({ id: `trade-${trade.ref}` });
    await d.waitFor({ id: 'admin-trade' });
    await capture('trade');
    await d.back();
    await d.tap({ id: 'tab-subscribers' });
    await d.waitFor({ id: 'subscribers-list' });
    await capture('subscribers');
    await d.tap({ id: 'tab-more' });
    await d.waitFor({ id: 'more' });
    await capture('more');
  });
  await act(trade, 'CANCEL', {});
  await d.shell('am', 'force-stop', PACKAGE);
  await launch();
  await d.waitFor({ id: 'dashboard' }, 40_000);
  await d.tap({ id: 'quick-buy' });
  await d.waitFor({ id: 'compose-levels' });
  await d.tap({ id: 'compose-close' });
  if (problems.length) throw new Error(problems.join('\n'));
};

J['screens-large-text'] = async () => {
  // Someone who has made their phone's text larger must still be able to read levels and use every control.
  await signInSubscriber();
  await d.shell('settings', 'put', 'system', 'font_scale', '1.3');
  await launch();
  d.prefix = 'large-text';
  await d.waitFor({ id: 'feed-list' }, 40_000);
  await capture('feed');
  await d.tap({ any: /^feed-card-/ });
  await d.waitFor({ id: 'trade-detail' });
  await capture('trade');
  await d.back();
  await d.tap({ id: 'tab-account' });
  await d.waitFor({ id: 'subscription' });
  await capture('account');
  await d.shell('settings', 'put', 'system', 'font_scale', '1.0');
  d.prefix = '';
  if (problems.length) throw new Error(problems.join('\n'));
};

const names = process.argv.slice(2);
const chosen = names.length ? names : Object.keys(J);
for (const name of chosen) {
  const started = Date.now();
  problems.length = 0;
  try {
    await J[name]();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.warn(`PASS ${name} (${Math.round((Date.now() - started) / 1000)}s)`);
  } catch (error) {
    const shot = await d.screenshot(`FAIL-${name}`).catch(() => null);
    results.push({ name, ok: false, error: String(error.message).slice(0, 800), shot });
    console.warn(`FAIL ${name}: ${String(error.message).slice(0, 700)}`);
    await d.shell('svc', 'wifi', 'enable').catch(() => undefined);
    await d.shell('svc', 'data', 'enable').catch(() => undefined);
    await network('restore').catch(() => undefined);
    await d.resetSize().catch(() => undefined);
    await d.shell('settings', 'put', 'system', 'font_scale', '1.0').catch(() => undefined);
  }
}
const passed = results.filter((r) => r.ok).length;
console.warn(`\n${passed} of ${results.length} journeys passed`);
writeFileSync(join(d.artifacts, 'report.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
process.exit(passed === results.length ? 0 : 1);
