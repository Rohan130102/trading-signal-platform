import { expect, test } from '@playwright/test';
import { actViaApi, adminApi, createSubscriberViaApi, nextPrice, publishViaApi, signInFirstTime } from './helpers.js';

const fmt = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: 2 });

test('complete subscriber journey', async ({ page }) => {
  const api = await adminApi();
  const sub = await createSubscriberViaApi(api);

  await test.step('first sign-in leads straight to the feed', async () => {
    await signInFirstTime(page, sub);
    await expect(page.getByRole('heading', { name: 'Feed' })).toBeVisible();
    await expect(page.getByText('Live', { exact: true })).toBeVisible();
  });

  const entry = nextPrice();
  const trade = await publishViaApi(api, entry);

  const card = page.getByRole('link', { name: new RegExp(`Open trade ${trade.ref}`) }).first();
  await test.step('a new signal appears with no refresh and reads clearly', async () => {
    await expect(card).toBeVisible();
    await expect(card.getByText('New signal')).toBeVisible();
    await expect(card.getByText('BUY', { exact: true })).toBeVisible();
    await expect(card.getByText(fmt(entry), { exact: true })).toBeVisible();
    await expect(card.getByText(fmt(entry + 150), { exact: true })).toBeVisible();
    await expect(card.getByText(fmt(entry - 180), { exact: true })).toBeVisible();
    await expect(card.getByText('Awaiting entry')).toBeVisible();
  });

  await test.step('Signals lists it under Upcoming with current levels', async () => {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Signals' }).click();
    await expect(page.getByRole('heading', { name: /^Upcoming/ })).toBeVisible();
    await page.getByRole('link', { name: new RegExp(trade.ref) }).click();
    await expect(page.getByRole('heading', { name: 'XAU/USD' })).toBeVisible();
    await expect(page.getByText(/waiting for its entry/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Original signal' })).toBeVisible();
  });

  await test.step('an update changes the open trade page by itself, keeping the original visible', async () => {
    const active = await actViaApi(api, trade, 'ACTIVATE');
    await expect(page.getByText(/This trade is active/)).toBeVisible();
    await actViaApi(api, active, 'MOVE_STOP', { price: String(entry - 50), comment: 'Reducing risk.' });
    await expect(page.getByText('Stop-loss (now)')).toBeVisible();
    await expect(page.getByText(fmt(entry - 50), { exact: true }).first()).toBeVisible();
    await expect(page.getByText(`was`).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /Move stop-loss to/ })).toBeVisible();
    await expect(page.getByText('Reducing risk.')).toBeVisible();
    // The subscriber sees who moved nothing and no position information.
    await expect(page.getByText(/Owner Admin/)).toHaveCount(0);
  });

  await test.step('the update in the feed reads as an update, not a new entry', async () => {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Feed' }).click();
    const update = page
      .getByRole('link', { name: new RegExp(`Open trade ${trade.ref}`) })
      .filter({ hasText: 'Stop-loss' })
      .first();
    await expect(update.getByText(`Update to ${trade.ref}`)).toBeVisible();
    await expect(update.getByText('changed to', { exact: false }).or(update.getByText(fmt(entry - 50)))).toBeVisible();
    await expect(update.getByText('New signal')).toHaveCount(0);
  });

  await test.step('history finds it, and search can come up empty with a way out', async () => {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'History' }).click();
    await page.getByLabel('Search').fill(trade.ref);
    await expect(page.getByRole('link', { name: new RegExp(trade.ref) })).toBeVisible();
    await page.getByLabel('Search').fill('zzz-nothing');
    await expect(page.getByText('Nothing matches those filters')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByRole('link', { name: new RegExp(trade.ref) })).toBeVisible();
  });

  await test.step('account explains the subscription in plain words', async () => {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Account' }).click();
    await expect(page.getByText(/30 days left, including today/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
    await expect(page.getByText(/Phone alerts can arrive late/)).toBeVisible();
  });
});

test('the app stays live across a refresh during an active trade', async ({ page }) => {
  const api = await adminApi();
  const sub = await createSubscriberViaApi(api);
  await signInFirstTime(page, sub);
  const trade = await publishViaApi(api);
  await page.goto(`/app/trades/${trade.id}`);
  await expect(page.getByRole('heading', { name: 'Original signal' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Original signal' })).toBeVisible();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await actViaApi(api, trade, 'CANCEL', { comment: 'Setup gone.' });
  await expect(page.getByText(/cancelled before entry/)).toBeVisible();
});

test('an unread count shows on other screens and clears on the feed', async ({ page }) => {
  const api = await adminApi();
  const sub = await createSubscriberViaApi(api);
  await signInFirstTime(page, sub);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Signals' }).click();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await publishViaApi(api);
  const feedLink = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /Feed/ });
  await expect(feedLink.getByText('1 unread').or(feedLink.getByText('1', { exact: true }))).toBeVisible();
  // The count comes from the server, so it survives arriving on another screen.
  await page.reload();
  await expect(feedLink.getByText('1 unread').or(feedLink.getByText('1', { exact: true }))).toBeVisible();
  await feedLink.click();
  await expect(feedLink.getByText(/unread/)).toHaveCount(0);
});

test('times stay truthful on a feed left open, and show the actual time', async ({ page }) => {
  await page.clock.install();
  const api = await adminApi();
  const sub = await createSubscriberViaApi(api);
  await signInFirstTime(page, sub);
  const trade = await publishViaApi(api);
  const card = page.getByRole('link', { name: new RegExp(`Open trade ${trade.ref}`) }).first();
  await expect(card.getByText(/just now/)).toBeVisible();
  await page.clock.fastForward('10:00');
  await expect(card.getByText(/\b10m ago/)).toBeVisible();
  await expect(card.getByText(/\d:\d\d\s?(AM|PM|am|pm)? · 10m ago/)).toBeVisible();
});

test('sign out ends the session and returns to sign-in', async ({ page }) => {
  const api = await adminApi();
  const sub = await createSubscriberViaApi(api);
  await signInFirstTime(page, sub);
  await page.goto('/app/account');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/app');
  await expect(page).toHaveURL(/\/login/);
});

test('wrong credentials explain themselves and reveal nothing', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email or username').fill('nobody.here');
  await page.getByLabel('Password', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'That email, username or password is not right.' }),
  ).toBeVisible();
});
