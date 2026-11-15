import { expect, test } from '@playwright/test';
import { actViaApi, adminApi, createSubscriberViaApi, publishViaApi, signInFirstTime } from './helpers.js';

test('reconnect journey: events missed while disconnected appear once, in order', async ({ page }) => {
  const api = await adminApi();
  const sub = await createSubscriberViaApi(api);

  let blocked = false;
  const sockets: { close: () => Promise<void> }[] = [];
  await page.routeWebSocket('**/ws', (ws) => {
    if (blocked) {
      void ws.close({ code: 1011, reason: 'blocked by test' });
      return;
    }
    ws.connectToServer();
    sockets.push(ws);
  });

  await signInFirstTime(page, sub);
  await page.goto('/app/alerts');
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  const before = await publishViaApi(api);
  await expect(page.getByRole('link', { name: new RegExp(before.ref) }).first()).toBeVisible();

  await test.step('losing the connection is visible and does not break the page', async () => {
    blocked = true;
    await Promise.all(sockets.map((s) => s.close()));
    await expect(page.getByText('Reconnecting. Prices and updates here may be out of date.')).toBeVisible();
  });

  const first = await publishViaApi(api);
  const activated = await actViaApi(api, first, 'ACTIVATE');
  await actViaApi(api, activated, 'MOVE_STOP', { price: String(Number(first.stopLoss) + 20) });
  const second = await publishViaApi(api);
  await page.waitForTimeout(500);
  await expect(page.getByRole('link', { name: new RegExp(second.ref) })).toHaveCount(0);

  await test.step('on reconnect everything appears, once, newest first', async () => {
    blocked = false;
    await expect(page.getByRole('link', { name: new RegExp(`Open trade ${second.ref}`) })).toBeVisible({
      timeout: 40_000,
    });
    await expect(page.getByText('Reconnecting.')).toHaveCount(0);
    const labels = await page
      .getByRole('main')
      .getByRole('link')
      .evaluateAll((links) => links.map((a) => a.textContent ?? ''));
    const refsInOrder = labels.map((l) => /T-\d+/.exec(l)?.[0]);
    const firstPos = refsInOrder.filter((r) => r === first.ref);
    expect(firstPos).toHaveLength(3); // published, activated, stop moved
    expect(refsInOrder.filter((r) => r === second.ref)).toHaveLength(1);
    expect(refsInOrder.filter((r) => r === before.ref)).toHaveLength(1);
    expect(refsInOrder.indexOf(second.ref)).toBeLessThan(refsInOrder.indexOf(first.ref));
    expect(refsInOrder.indexOf(first.ref)).toBeLessThan(refsInOrder.indexOf(before.ref));
  });

  await test.step('a reload shows the same list', async () => {
    const labels = () =>
      page
        .getByRole('main')
        .getByRole('link')
        .evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''));
    const before = await labels();
    await page.reload();
    await expect(page.getByRole('link', { name: new RegExp(`Open trade ${second.ref}`) })).toBeVisible();
    const after = await labels();
    expect(after.length).toBeGreaterThan(0);
    expect(after).toEqual(before.slice(0, after.length));
  });
});

test('going offline says so, and the app recovers when back online', async ({ page, context }) => {
  const api = await adminApi();
  const sub = await createSubscriberViaApi(api);
  await signInFirstTime(page, sub);
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText(/You are offline/)).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText(/You are offline/)).toHaveCount(0);
});
