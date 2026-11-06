import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { adminApi, createSubscriberViaApi, expireSubscriber, publishViaApi, signInFirstTime } from './helpers.js';

test('expiry journey: access ends while the app is open, renewal restores it', async ({ page }) => {
  const api = await adminApi();
  const sub = await createSubscriberViaApi(api);
  await signInFirstTime(page, sub);
  const trade = await publishViaApi(api);
  await page.goto(`/app/trades/${trade.id}`);
  await expect(page.getByRole('heading', { name: 'XAU/USD' })).toBeVisible();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();

  await test.step('protected content disappears without a refresh', async () => {
    await expireSubscriber(api, sub.id);
    await expect(page.getByRole('heading', { name: 'Your subscription has ended' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(trade.ref)).toHaveCount(0);
    await expect(page.getByText(/renew/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });

  await test.step('the API refuses even if the page is bypassed', async () => {
    const res = await page.request.get('/api/v1/feed');
    expect(res.status()).toBe(403);
    expect((await res.json()).error.code).toBe('SUBSCRIPTION_EXPIRED');
    const direct = await page.request.get(`/api/v1/trades/${trade.id}`);
    expect(direct.status()).toBe(403);
  });

  await test.step('nothing private remains in the page after a reload', async () => {
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Your subscription has ended' })).toBeVisible();
    expect(await page.content()).not.toContain(trade.ref);
  });

  await test.step('renewal restores access', async () => {
    const renewed = await api.post(`/api/v1/admin/subscribers/${sub.id}/renew`, {
      data: { durationDays: 7, idempotencyKey: randomUUID() },
    });
    expect(renewed.status()).toBe(201);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'XAU/USD' })).toBeVisible();
    await expect(page.getByText(trade.ref)).toBeVisible();
  });
});

test('suspension signs the subscriber out at once', async ({ page }) => {
  const api = await adminApi();
  const sub = await createSubscriberViaApi(api);
  await signInFirstTime(page, sub);
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await api.post(`/api/v1/admin/subscribers/${sub.id}/suspend`, { data: {} });
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
});
