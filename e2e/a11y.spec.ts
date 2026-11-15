import AxeBuilder from '@axe-core/playwright';
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

async function scan(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const summary = results.violations.map(
    (v) =>
      `${label}: ${v.id} (${v.impact}): ${v.nodes
        .map((n) => n.target.join(' '))
        .slice(0, 3)
        .join(' | ')} :: ${v.nodes[0]?.any[0]?.message ?? ''}`,
  );
  expect(summary, `Accessibility violations on ${label}`).toEqual([]);
}

async function setTheme(page: Page, theme: 'dark' | 'light') {
  await page.evaluate((t) => {
    localStorage.setItem('sd-theme', t);
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
}

for (const theme of ['dark', 'light'] as const) {
  test.describe(`${theme} theme`, () => {
    test('public and sign-in pages', async ({ page }) => {
      for (const [path, label] of [
        ['/', 'home'],
        ['/disclosures', 'disclosures'],
        ['/login', 'login'],
      ] as const) {
        await page.goto(path);
        await setTheme(page, theme);
        await page.waitForTimeout(100);
        await scan(page, `${label} (${theme})`);
      }
    });

    test('subscriber screens', async ({ page }) => {
      const api = await adminApi();
      const sub = await createSubscriberViaApi(api);
      await signInFirstTime(page, sub);
      const entry = nextPrice();
      const trade = await publishViaApi(api, entry, {
        targets: [String(entry + 100), String(entry + 200)],
        commentary: 'Sample commentary.',
      });
      const active = await actViaApi(api, trade, 'ACTIVATE');
      const hit = await actViaApi(api, active, 'TARGET_HIT', { targetIndex: 1 });
      await actViaApi(api, hit, 'MOVE_STOP', { price: String(entry) });
      await publishViaApi(api, nextPrice(), {
        direction: 'SELL',
        targets: [String(100000)],
        stopLoss: String(900000),
        entryLow: String(500000),
        entryHigh: String(500000),
      }).catch(() => undefined);
      for (const [path, label] of [
        ['/app', 'signals'],
        ['/app/alerts', 'alerts'],
        ['/app/news', 'news'],
        ['/app/history', 'history'],
        [`/app/trades/${trade.id}`, 'trade'],
        ['/app/account', 'account'],
      ] as const) {
        await page.goto(path);
        await setTheme(page, theme);
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        await page.waitForTimeout(300);
        await scan(page, `${label} (${theme})`);
      }
    });

    test.describe('administrator screens', () => {
      test.use({ storageState: ADMIN_STATE });
      test('all of them', async ({ page }) => {
        test.setTimeout(120_000);
        const api = await adminApi();
        const entry = nextPrice();
        const trade = await publishViaApi(api, entry);
        const active = await actViaApi(api, trade, 'ACTIVATE');
        const closed = await actViaApi(api, active, 'CLOSE', {
          exitPrice: String(entry + 150),
          basis: 'HYPOTHETICAL_OUTCOME',
          reason: 'TARGET_ACHIEVED',
          confirm: true,
        });
        const sub = await createSubscriberViaApi(api, 3);
        const pages: [string, string][] = [
          ['/admin', 'dashboard'],
          ['/admin/compose', 'composer'],
          ['/admin/trades', 'trades'],
          [`/admin/trades/${closed.id}`, 'trade'],
          ['/admin/subscribers', 'subscribers'],
          [`/admin/subscribers/${sub.id}`, 'subscriber'],
          ['/admin/instruments', 'instruments'],
          ['/admin/templates', 'templates'],
          ['/admin/performance', 'performance'],
          ['/admin/notifications', 'health'],
          ['/admin/audit', 'audit'],
          ['/admin/settings', 'settings'],
          ['/admin/settings?tab=email', 'settings-email'],
        ];
        for (const [path, label] of pages) {
          await page.goto(path);
          await setTheme(page, theme);
          await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
          await page.waitForTimeout(300);
          await scan(page, `${label} (${theme})`);
        }
        await page.goto('/admin/compose');
        await setTheme(page, theme);
        await page.getByRole('radio', { name: /BUY/ }).check({ force: true });
        await page.getByLabel('Entry price').fill(String(nextPrice()));
        await page.getByRole('button', { name: /Review and publish/ }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.waitForTimeout(300);
        await scan(page, `publish dialog (${theme})`);
      });
    });
  });
}
