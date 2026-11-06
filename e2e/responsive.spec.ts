import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import {
  ADMIN_STATE,
  actViaApi,
  adminApi,
  createSubscriberViaApi,
  nextPrice,
  publishViaApi,
  signInFirstTime,
} from './helpers.js';

const dir = resolve(import.meta.dirname, 'screenshots');
mkdirSync(dir, { recursive: true });

async function capture(page: Page, name: string, projectName: string): Promise<void> {
  await page.waitForTimeout(350);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${name} scrolls sideways by ${overflow}px on ${projectName}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: resolve(dir, `${projectName}-${name}.png`), fullPage: true });
}

test('subscriber screens fit the screen', async ({ page }, info) => {
  const api = await adminApi();
  const sub = await createSubscriberViaApi(api);
  await signInFirstTime(page, sub);
  const entry = nextPrice();
  const trade = await publishViaApi(api, entry, {
    targets: [String(entry + 100), String(entry + 200), String(entry + 300)],
    commentary: 'Waiting for a pullback into the range.',
  });
  const active = await actViaApi(api, trade, 'ACTIVATE');
  const reached = await actViaApi(api, active, 'TARGET_HIT', { targetIndex: 1 });
  await actViaApi(api, reached, 'MOVE_STOP', {
    price: String(entry + 10),
    comment: 'Locking in breakeven plus a little.',
  });
  const low = nextPrice();
  await publishViaApi(api, low, {
    direction: 'SELL',
    entryType: 'RANGE',
    entryLow: String(low),
    entryHigh: String(low + 12),
    targets: [String(low - 150)],
    stopLoss: String(low + 192),
    priority: 'PRIORITY',
  });
  await admin(api, 'announcements', {
    message: 'Markets close early on Friday. No new signals after 17:00.',
    idempotencyKey: crypto.randomUUID(),
  });
  const closing = await publishViaApi(api);
  const closingActive = await actViaApi(api, closing, 'ACTIVATE');
  await actViaApi(api, closingActive, 'CLOSE', {
    exitPrice: String(Number(closing.entryLow) + 150),
    basis: 'HYPOTHETICAL_OUTCOME',
    reason: 'TARGET_ACHIEVED',
    confirm: true,
  });

  for (const [path, name] of [
    ['/app', 'feed'],
    ['/app/active', 'active'],
    ['/app/history', 'history'],
    [`/app/trades/${trade.id}`, 'trade'],
    [`/app/trades/${closing.id}`, 'trade-closed'],
    ['/app/account', 'account'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await capture(page, name, info.project.name);
  }
});

async function admin(api: Awaited<ReturnType<typeof adminApi>>, path: string, data: unknown) {
  const res = await api.post(`/api/v1/admin/${path}`, { data });
  expect(res.status(), await res.text()).toBeLessThan(300);
}

test.describe('administrator', () => {
  test.use({ storageState: ADMIN_STATE });
  test('admin screens fit the screen', async ({ page }, info) => {
    test.setTimeout(90_000);
    const api = await adminApi();
    const entry = nextPrice();
    const trade = await publishViaApi(api, entry, { targets: [String(entry + 100), String(entry + 200)] });
    const active = await actViaApi(api, trade, 'ACTIVATE', { actualEntry: String(entry), quantity: '2' });
    const partial = await actViaApi(api, active, 'BOOK_PARTIAL', {
      exitPrice: String(entry + 100),
      percent: '50',
      basis: 'ADMIN_DECLARED_EXECUTION',
    });
    const sub = await createSubscriberViaApi(api, 5);
    for (const [path, name] of [
      ['/admin', 'admin-dashboard'],
      ['/admin/trades', 'admin-trades'],
      [`/admin/trades/${partial.id}`, 'admin-trade'],
      ['/admin/subscribers', 'admin-subscribers'],
      [`/admin/subscribers/${sub.id}`, 'admin-subscriber'],
      ['/admin/instruments', 'admin-instruments'],
      ['/admin/templates', 'admin-templates'],
      ['/admin/performance?x=1', 'admin-performance'],
      ['/admin/notifications', 'admin-health'],
      ['/admin/audit', 'admin-audit'],
      ['/admin/settings', 'admin-settings'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await capture(page, name, info.project.name);
    }
    // A real running total to look at, on one instrument.
    for (let i = 0; i < 6; i += 1) {
      const p = nextPrice();
      const t = await actViaApi(api, await publishViaApi(api, p), 'ACTIVATE');
      await actViaApi(api, t, 'CLOSE', {
        exitPrice: String(p + [150, -180, 90, 150, -40, 150][i]!),
        basis: 'HYPOTHETICAL_OUTCOME',
        reason: 'MANUAL',
        confirm: true,
      });
    }
    await page.goto('/admin/performance');
    await page.getByLabel('Instrument').selectOption('XAU/USD');
    await expect(page.getByRole('img', { name: /Running total/ })).toBeVisible();
    await capture(page, 'admin-performance-chart', info.project.name);
    await page.evaluate(() => {
      localStorage.setItem('sd-theme', 'light');
      document.documentElement.setAttribute('data-theme', 'light');
    });
    await capture(page, 'admin-performance-chart-light', info.project.name);
    await page.goto('/admin/trades');
    await capture(page, 'admin-trades-light', info.project.name);
    await page.goto('/admin/compose');
    await page.getByRole('radio', { name: /SELL/ }).check({ force: true });
    await page.getByLabel('Entry price').fill(String(nextPrice()));
    await capture(page, 'admin-compose-light', info.project.name);
    await page.evaluate(() => {
      localStorage.setItem('sd-theme', 'dark');
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    await page.goto('/admin/compose');
    await page.getByRole('radio', { name: /BUY/ }).check({ force: true });
    await page.getByLabel('Entry price').fill(String(nextPrice()));
    await capture(page, 'admin-compose', info.project.name);
    await page.getByRole('button', { name: /Review and publish/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(dir, `${info.project.name}-admin-publish-dialog.png`) });
    await page.getByRole('button', { name: 'Close' }).click();
    await page.goto(`/admin/trades/${partial.id}`);
    await page.getByRole('button', { name: 'Close trade' }).click();
    await page
      .getByRole('dialog')
      .getByLabel('Exit price')
      .fill(String(entry + 200));
    await page.screenshot({ path: resolve(dir, `${info.project.name}-admin-close-dialog.png`) });
  });
});

test('public screens fit the screen', async ({ page }, info) => {
  for (const [path, name] of [
    ['/', 'home'],
    ['/login', 'login'],
    ['/disclosures', 'disclosures'],
  ] as const) {
    await page.goto(path);
    await capture(page, name, info.project.name);
  }
});

test('nothing scrolls sideways even at 320px wide', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of ['/', '/login', '/disclosures']) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  }
});
