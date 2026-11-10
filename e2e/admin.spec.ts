import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { generate } from 'otplib';
import {
  ADMIN_STATE,
  actViaApi,
  adminApi,
  adminState,
  createSubscriberViaApi,
  nextPrice,
  publishViaApi,
  signInFirstTime,
  uniqueLogin,
} from './helpers.js';

test.use({ storageState: ADMIN_STATE });

test('complete administrator journey', async ({ page, browser }) => {
  const entry = nextPrice();

  await test.step('dashboard leads with one dominant action', async () => {
    await page.goto('/admin');
    await expect(page.getByRole('link', { name: 'Publish new signal' })).toBeVisible();
    await expect(page.getByText('Worker running')).toBeVisible();
  });

  const login = uniqueLogin('journey');
  let temp = '';
  await test.step('create a subscriber and see credentials once', async () => {
    await page.goto('/admin/subscribers');
    await page.getByRole('button', { name: 'New subscriber' }).click();
    await page.getByLabel('Name').fill('Priya Sharma');
    await page.getByLabel('Login ID').fill(login);
    await page.getByLabel('Duration (days)').fill('30');
    await page.getByRole('button', { name: 'Create subscriber' }).click();
    await expect(page.getByText('Shown only this once')).toBeVisible();
    temp = (await page.getByTestId('temp-password').textContent()) as string;
    expect(temp).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    await page.getByRole('button', { name: 'Open subscriber' }).click();
    await expect(page.getByRole('heading', { name: /Priya Sharma/ })).toBeVisible();
    await expect(page.getByText('Created for 30 days')).toBeVisible();
    await expect(page.getByText(temp)).toHaveCount(0);
  });

  await test.step('publish a BUY: the levels are calculated and previewed before anything is sent', async () => {
    await page.goto('/admin/compose');
    await page.getByRole('radio', { name: /XAU\/USD/ }).check({ force: true });
    await page.getByRole('radio', { name: /BUY/ }).check({ force: true });
    await page.getByLabel('Entry price').fill(String(entry));
    const preview = page.getByRole('complementary', { name: 'Preview' });
    await expect(preview.getByText('Stop-loss', { exact: true })).toBeVisible();
    await expect(preview.getByText((entry - 180).toLocaleString('en-US', { minimumFractionDigits: 2 }))).toBeVisible();
    await expect(preview.getByText((entry + 150).toLocaleString('en-US', { minimumFractionDigits: 2 }))).toBeVisible();
    // New signals wait for entry by default; this journey asks for one that is active straight away.
    await expect(page.getByRole('radio', { name: /Awaiting entry \(default\)/ })).toBeChecked();
    await expect(page.getByLabel('Entry window')).toBeVisible();
    await page.getByRole('radio', { name: /Active now/ }).check({ force: true });
    await expect(page.getByLabel('Entry window')).toHaveCount(0);
    await page.getByRole('button', { name: /Review and publish/ }).click();
    await expect(page.getByRole('heading', { name: 'Publish this signal?' })).toBeVisible();
    await page.getByRole('button', { name: 'Publish now' }).click();
    await expect(page.getByRole('heading', { name: /Published as/ })).toBeVisible();
    await expect(page.getByText(/active straight away/)).toBeVisible();
    await expect(
      page.getByText('Handed to push services').or(page.getByText('Sending push')).or(page.getByText('Push queued')),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Open trade' }).click();
  });

  await test.step('a signal published as active needs no separate activation step', async () => {
    await expect(page.getByRole('main').getByText('Active', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Activate trade' })).toHaveCount(0);
  });

  await test.step('move the stop-loss: the original is retained in the timeline', async () => {
    await page.getByRole('button', { name: 'Move stop-loss' }).click();
    await page.getByLabel('New stop-loss').fill(String(entry + 50));
    await page.getByRole('button', { name: 'Move and notify' }).click();
    await expect(page.getByText('Stop-loss (now)')).toBeVisible();
    await expect(page.getByText(/was/).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /Move stop-loss to/ })).toBeVisible();
    await expect(page.getByText('By Owner Admin').first()).toBeVisible();
  });

  await test.step('widening risk needs a second, explicit confirmation', async () => {
    await page.getByRole('button', { name: 'Move stop-loss' }).click();
    await page.getByLabel('New stop-loss').fill(String(entry + 10));
    await page.getByRole('button', { name: 'Move and notify' }).click();
    await expect(page.getByText('This increases risk')).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
  });

  await test.step('close the trade and see the recorded result, labelled by its basis', async () => {
    await page.getByRole('button', { name: 'Close trade' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /At target 1/ }).click();
    await expect(dialog.getByLabel('What is this result based on?')).toHaveValue('HYPOTHETICAL_OUTCOME');
    await expect(dialog.getByText('+150 pts')).toBeVisible();
    await expect(dialog.getByText('None: no position recorded')).toBeVisible();
    await dialog.getByRole('button', { name: 'Close trade and notify' }).click();
    await expect(page.getByText(/This trade is finished/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Result' })).toBeVisible();
    await expect(page.getByRole('main').getByText('Hypothetical outcome of the signal')).toBeVisible();
  });

  await test.step('the internal dashboard shows it, with the methodology', async () => {
    await page.goto('/admin/performance');
    await expect(page.getByRole('heading', { name: 'Every record in this period' })).toBeVisible();
    await expect(page.getByText(/Win rate = wins/)).toBeVisible();
    await expect(
      page
        .getByRole('table', { name: /Finished trades/ })
        .getByText('+150 pts')
        .first(),
    ).toBeVisible();
  });

  await test.step('the audit log records who did what', async () => {
    await page.goto('/admin/audit');
    await expect(page.getByText('TRADE_CLOSE').first()).toBeVisible();
    await page.getByRole('button', { name: 'Verify signal history' }).click();
    await expect(page.getByText(/hash chain over \d+ events is intact/)).toBeVisible();
  });

  await test.step('that new subscriber can sign in with the temporary password', async () => {
    const context = await browser.newContext({ storageState: undefined });
    const subscriberTab = await context.newPage();
    await subscriberTab.goto('/login');
    await subscriberTab.getByLabel('Login ID').fill(login);
    await subscriberTab.getByLabel('Password', { exact: true }).fill(temp);
    await subscriberTab.getByRole('button', { name: 'Sign in' }).click();
    await expect(subscriberTab.getByRole('heading', { name: 'Choose your password' })).toBeVisible();
    await context.close();
  });
});

test('keyboard-only publishing takes five keystroke groups', async ({ page }) => {
  await page.goto('/admin/compose');
  await expect(page.getByRole('radio', { name: /XAU\/USD/ })).toBeAttached();
  const entry = nextPrice();
  // 1: instrument, S: direction (focus jumps to the price), type, Enter: review, Enter: publish.
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('1');
  await page.keyboard.press('s');
  await page.keyboard.type(String(entry));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Publish this signal?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish now' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: /Published as/ })).toBeVisible();
  const api = await adminApi();
  const list = await (await api.get(`/api/v1/admin/trades?q=&live=true&pageSize=5`)).json();
  const mine = list.trades.find((t: { entryLow: string }) => t.entryLow === String(entry));
  expect(mine.direction).toBe('SELL');
  expect(mine.stopLoss).toBe(String(entry + 180));
  expect(mine.targets[0].price).toBe(String(entry - 150));
});

test('duplicate protection: a double click publishes one signal', async ({ page }) => {
  const api = await adminApi();
  const entry = nextPrice();
  await page.goto('/admin/compose');
  await page.getByRole('radio', { name: /BUY/ }).check({ force: true });
  await page.getByLabel('Entry price').fill(String(entry));
  await page.getByRole('button', { name: /Review and publish/ }).click();
  await page.getByRole('button', { name: 'Publish now' }).dblclick();
  await expect(page.getByRole('heading', { name: /Published as/ })).toBeVisible();
  const list = await (await api.get(`/api/v1/admin/trades?live=true&pageSize=100`)).json();
  expect(list.trades.filter((t: { entryLow: string }) => t.entryLow === String(entry))).toHaveLength(1);
});

test('duplicate protection: a retry after a lost response publishes one signal', async ({ page }) => {
  const api = await adminApi();
  const entry = nextPrice();
  let dropped = false;
  await page.route('**/api/v1/admin/signals', async (route) => {
    if (dropped) return route.continue();
    dropped = true;
    // The server processes it, then the response is lost on the way back.
    await route.fetch();
    await route.abort('connectionreset');
  });
  await page.goto('/admin/compose');
  await page.getByRole('radio', { name: /BUY/ }).check({ force: true });
  await page.getByLabel('Entry price').fill(String(entry));
  await page.getByRole('button', { name: /Review and publish/ }).click();
  await page.getByRole('button', { name: 'Publish now' }).click();
  await expect(page.getByRole('dialog').getByText(/Could not reach the server/)).toBeVisible();
  await page.getByRole('button', { name: 'Publish now' }).click();
  await expect(page.getByRole('heading', { name: /Published as/ })).toBeVisible();
  const list = await (await api.get(`/api/v1/admin/trades?live=true&pageSize=100`)).json();
  expect(list.trades.filter((t: { entryLow: string }) => t.entryLow === String(entry))).toHaveLength(1);
});

test('warns about a likely duplicate and lets the administrator decide', async ({ page }) => {
  const api = await adminApi();
  const entry = nextPrice();
  const first = await publishViaApi(api, entry);
  await page.goto('/admin/compose');
  await page.getByRole('radio', { name: /BUY/ }).check({ force: true });
  await page.getByLabel('Entry price').fill(String(entry));
  await page.getByRole('button', { name: /Review and publish/ }).click();
  await page.getByRole('button', { name: 'Publish now' }).click();
  await expect(page.getByText('Possible duplicate')).toBeVisible();
  await expect(page.getByRole('link', { name: `Open ${first.ref}` })).toBeVisible();
  await page.getByRole('button', { name: 'Publish anyway' }).click();
  await expect(page.getByRole('heading', { name: /Published as/ })).toBeVisible();
});

test('invalid prices are caught before review, and SELL arithmetic is right', async ({ page }) => {
  await page.goto('/admin/compose');
  await page.getByRole('radio', { name: /SELL/ }).check({ force: true });
  await page.getByLabel('Entry price').fill('abc');
  await expect(page.getByText('Enter a plain number')).toBeVisible();
  await expect(page.getByRole('button', { name: /Review and publish/ })).toBeDisabled();
  await page.getByLabel('Entry price').fill('3300.123');
  await expect(page.getByRole('alert').filter({ hasText: 'Entry allows at most 2 decimal places' })).toBeVisible();
  await expect(page.getByText(/Stop-loss allows at most/)).toHaveCount(0);
  await page.getByLabel('Entry price').fill('100');
  await expect(page.getByText(/must be greater than zero/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Review and publish/ })).toBeDisabled();
});

test('entry range uses the conservative convention and explains itself', async ({ page }) => {
  const low = nextPrice();
  await page.goto('/admin/compose');
  await page.getByRole('radio', { name: /BUY/ }).check({ force: true });
  await page.getByRole('radio', { name: 'Range' }).check({ force: true });
  await page.getByLabel('Lower price').fill(String(low));
  await page.getByLabel('Upper price').fill(String(low + 10));
  await page.getByText('How this was calculated').click();
  await expect(page.getByText(`Target 1: upper entry ${low + 10} + 150 pts`, { exact: false })).toBeVisible();
  await expect(page.getByText(`Stop-loss: lower entry ${low} − 180 pts`, { exact: false })).toBeVisible();
  await page.getByLabel('Lower price').fill(String(low + 20));
  await expect(page.getByText('Lower entry must not exceed upper entry')).toBeVisible();
});

test('a draft survives a refresh and publishes as itself, leaving no orphan', async ({ page }) => {
  const api = await adminApi();
  const entry = nextPrice();
  await page.goto('/admin/compose');
  await page.getByRole('radio', { name: /BUY/ }).check({ force: true });
  await page.getByLabel('Entry price').fill(String(entry));
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Entry price')).toHaveValue(String(entry));
  await page.getByRole('button', { name: /Review and publish/ }).click();
  await page.getByRole('button', { name: 'Publish now' }).click();
  await expect(page.getByRole('heading', { name: /Published as/ })).toBeVisible();
  const drafts = await (await api.get('/api/v1/admin/drafts')).json();
  expect(drafts.drafts.filter((d: { draft: { entryLow: string } }) => d.draft.entryLow === String(entry))).toHaveLength(
    0,
  );
});

test('financial integrity: closing a range signal with no data invents no result', async ({ page }) => {
  const api = await adminApi();
  const low = nextPrice();
  const trade = await publishViaApi(api, low, {
    entryType: 'RANGE',
    entryLow: String(low),
    entryHigh: String(low + 10),
    targets: [String(low + 160)],
    stopLoss: String(low - 180),
  });
  await actViaApi(api, trade, 'ACTIVATE');
  await page.goto(`/admin/trades/${trade.id}`);
  await page.getByRole('button', { name: 'Close trade' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('What is this result based on?')).toHaveValue('NONE');
  await expect(dialog.getByRole('option', { name: /record your execution first/ })).toBeDisabled();
  await dialog.getByLabel('Exit price').fill(String(low + 100));
  await expect(dialog.getByText('Not measured')).toBeVisible();
  await expect(dialog.getByText('None: no position recorded')).toBeVisible();

  await dialog.getByLabel('What is this result based on?').selectOption('HYPOTHETICAL_OUTCOME');
  await dialog.getByRole('button', { name: 'Close trade and notify' }).click();
  await expect(dialog.getByText(/recommended a range/)).toBeVisible();

  await dialog.getByLabel('What is this result based on?').selectOption('NONE');
  await dialog.getByRole('button', { name: 'Close trade and notify' }).click();
  await expect(page.getByText(/This trade is finished/)).toBeVisible();
  const main = page.getByRole('main');
  await expect(main.getByText('Not measured').first()).toBeVisible();
  await expect(main.getByText('No position recorded')).toBeVisible();
  await expect(main.getByText(/\bUSD\b/).filter({ hasText: /[+−-]?\d[\d,]*\.\d{2} USD/ })).toHaveCount(0);
});

test('declared execution shows money, privately, and only with full data', async ({ page, request: _ }) => {
  const api = await adminApi();
  const entry = nextPrice();
  const published = await publishViaApi(api, entry);
  const active = await actViaApi(api, published, 'ACTIVATE', { actualEntry: String(entry), quantity: '2' });
  await page.goto(`/admin/trades/${active.id}`);
  await page.getByRole('button', { name: 'Book partial' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Exit price').fill(String(entry + 100));
  await expect(dialog.getByText('100.00 USD')).toBeVisible();
  await dialog.getByRole('button', { name: 'Book partial and notify' }).click();
  await expect(page.getByText('Partly closed').first()).toBeVisible();
  await page.getByRole('button', { name: 'Close trade' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Exit price').fill(String(entry + 200));
  await dialog.getByLabel(/Fees/).fill('10');
  await dialog.getByRole('button', { name: 'Close trade and notify' }).click();
  await expect(page.getByText(/This trade is finished/)).toBeVisible();
  // 1 x 100 + 1 x 200 = 300, less 10 of fees.
  await expect(page.getByText('290.00 USD').first()).toBeVisible();
  await expect(page.getByText('Execution declared by the administrator (unverified)').first()).toBeVisible();
});

test('trade actions work from the keyboard, and shortcuts stay out of the way while typing', async ({ page }) => {
  const api = await adminApi();
  const entry = nextPrice();
  const active = await actViaApi(api, await publishViaApi(api, entry), 'ACTIVATE');
  await page.goto(`/admin/trades/${active.id}`);
  await expect(page.getByRole('heading', { name: 'XAU/USD', exact: true })).toBeVisible();

  // M, type the price, Enter: three inputs to move a stop.
  await page.keyboard.press('m');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Move stop-loss' })).toBeVisible();
  await expect(dialog.getByLabel('New stop-loss')).toBeFocused();
  await page.keyboard.type(String(entry - 100));
  await page.keyboard.press('Enter');
  await expect(page.getByText('Stop-loss (now)')).toBeVisible();

  // A letter typed into a field is text, not a shortcut.
  await page.keyboard.press('u');
  await expect(dialog.getByRole('heading', { name: 'Send urgent instruction' })).toBeVisible();
  await dialog.getByLabel('Instruction').pressSequentially('c m t');
  await expect(dialog.getByLabel('Instruction')).toHaveValue('c m t');
  await expect(dialog.getByRole('heading', { name: 'Send urgent instruction' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // Shortcuts for actions not allowed in this state do nothing.
  await page.keyboard.press('a');
  await expect(dialog).toHaveCount(0);
});

test('a stale screen is told to refresh rather than overwriting', async ({ page }) => {
  const api = await adminApi();
  const entry = nextPrice();
  const published = await publishViaApi(api, entry);
  const active = await actViaApi(api, published, 'ACTIVATE');
  await page.goto(`/admin/trades/${active.id}`);
  await page.getByRole('button', { name: 'Urgent instruction' }).click();
  await actViaApi(api, active, 'URGENT', { message: 'From another administrator' });
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Instruction').fill('From this stale screen');
  await dialog.getByRole('button', { name: 'Send to subscribers' }).click();
  await expect(page.getByText('This trade just changed')).toBeVisible();
  const detail = await (await api.get(`/api/v1/admin/trades/${active.id}`)).json();
  const urgent = detail.events.filter((e: { type: string }) => e.type === 'URGENT_INSTRUCTION');
  expect(urgent).toHaveLength(1);
  expect(urgent[0].payload.message).toBe('From another administrator');
});

test('instruments can be added without code, and appear in the composer', async ({ page }) => {
  const symbol = `E2E${Date.now().toString(36).toUpperCase().slice(-4)}/USD`;
  await page.goto('/admin/instruments');
  await page.getByRole('button', { name: 'New instrument' }).click();
  await page.getByLabel('Symbol').fill(symbol);
  await page.getByLabel('Display name').fill('E2E Test');
  await page.getByLabel('Unit label').fill('lot');
  await page.getByLabel('Value of 1 point').fill('10');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('cell', { name: `${symbol} E2E Test` })).toBeVisible();
  await page.goto('/admin/compose');
  await page.getByRole('radio', { name: new RegExp(symbol.replace('/', '\\/')) }).check({ force: true });
  await page.getByRole('radio', { name: /BUY/ }).check({ force: true });
  await page.getByLabel('Entry price').fill('5000');
  // 150 and 180 points at 10 per point.
  const preview = page.getByRole('complementary', { name: 'Preview' });
  await expect(preview.getByText('6,500.00')).toBeVisible();
  await expect(preview.getByText('3,200.00')).toBeVisible();
  await page.goto('/admin/instruments');
  await page.getByRole('button', { name: `Edit ${symbol}` }).click();
  await page.getByRole('switch', { name: 'Available for new signals' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('row', { name: new RegExp(symbol.replace('/', '\\/')) }).getByText('Off')).toBeVisible();
});

test('renewal from the subscriber page says which policy applies', async ({ page }) => {
  const api = await adminApi();
  const loginId = uniqueLogin('renew');
  const res = await api.post('/api/v1/admin/subscribers', {
    data: { name: 'Renew Me', loginId, durationDays: 5, idempotencyKey: randomUUID() },
  });
  const { subscriber } = await res.json();
  await page.goto(`/admin/subscribers/${subscriber.id}`);
  await page.getByRole('button', { name: 'Renew' }).click();
  await expect(page.getByText(/Still active, so the new days are added after/)).toBeVisible();
  await page.getByLabel('Days to add').fill('10');
  await page.getByRole('dialog').getByRole('button', { name: 'Renew' }).click();
  await expect(page.getByText(/Renewed for 10 days, extended from expiry/)).toBeVisible();
});

test('an announcement reaches the feed as an announcement, not a trade', async ({ page, browser }) => {
  const api = await adminApi();
  const sub = await createSubscriberViaApi(api);
  const subscriber = await (await browser.newContext({ storageState: { cookies: [], origins: [] } })).newPage();
  await signInFirstTime(subscriber, sub);
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Announcement' }).click();
  const text = `Markets close early ${Date.now()}.`;
  await page.getByLabel('Message').fill(text);
  await page.getByRole('button', { name: 'Send to subscribers' }).click();
  await expect(page.getByText('Announcement sent to subscribers')).toBeVisible();
  const card = subscriber.getByRole('article').filter({ hasText: text });
  await expect(card).toBeVisible();
  await expect(card.getByText('Announcement')).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Market update' })).toBeVisible();
  await subscriber.context().close();
});

test('publish similar carries instrument and direction, never old prices', async ({ page }) => {
  const api = await adminApi();
  const trade = await publishViaApi(api);
  await page.goto(`/admin/trades/${trade.id}`);
  await page.getByRole('link', { name: 'Publish a new signal on XAU/USD' }).click();
  await expect(page.getByRole('radio', { name: /BUY/ })).toBeChecked();
  await expect(page.getByLabel('Entry price')).toHaveValue('');
});

test('a later administrator sign-in asks for a code', async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  const { login } = adminState();
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Login ID').fill(login);
  await page.getByLabel('Password', { exact: true }).fill('quiet-river-stone-lamp');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
  await page.getByLabel('Code', { exact: true }).fill('000000');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('That code is not right')).toBeVisible();
  const secret = readFileSync(resolve(import.meta.dirname, '.state/mfa.txt'), 'utf8').trim();
  // One step ahead: the code from the setup step was already used and cannot be used again.
  const code = await generate({ secret, epoch: Math.floor(Date.now() / 1000) + 30 });
  await page.getByLabel('Code', { exact: true }).fill(code);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await context.close();
});

test('public performance stays closed, and the settings page says why', async ({ page }) => {
  await page.goto('/admin/settings');
  await expect(page.getByRole('heading', { name: 'Public performance section' })).toBeVisible();
  await expect(page.getByText('Closed', { exact: true })).toBeVisible();
  await expect(page.getByText(/A disclaimer alone does not make/)).toBeVisible();
  // The About page is public; without the compliance gate it shows no figure at all.
  await page.goto('/results');
  await expect(page).toHaveURL(/\/about#performance$/);
  await expect(page.getByText('Results are not published yet')).toBeVisible();
  await expect(page.getByText('Win rate')).toHaveCount(0);
});

test('the Master Admin sets platform rules and registers administrators', async ({ page }) => {
  await page.goto('/admin/settings');
  await expect(page.getByRole('heading', { name: 'Signals' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Awaiting entry' })).toBeChecked();
  await expect(page.getByLabel('Entry window')).toHaveValue('240');
  await page.goto('/admin/admins');
  await expect(page.getByRole('heading', { name: 'Administrators' })).toBeVisible();
  await expect(page.getByText('Master Admin').first()).toBeVisible();
});
