import { expect, test } from '@playwright/test';
import { ADMIN_STATE, adminApi, createSubscriberViaApi, publishViaApi, signInFirstTime } from './helpers.js';
import { WEB_ORIGIN } from './ports.js';

test.describe('visitors with no account', () => {
  test('cannot reach private areas', async ({ page }) => {
    for (const path of ['/app', '/app/active', '/admin', '/admin/subscribers']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login\?next=/);
    }
  });

  test('a forged session cookie gets nothing', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'sd_session', value: 'forged-token', url: baseURL as string }]);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login/);
    const res = await page.request.get('/api/v1/admin/subscribers');
    expect(res.status()).toBe(401);
  });

  test('public pages hold no signal data and make no performance claims', async ({ page }) => {
    const api = await adminApi();
    const trade = await publishViaApi(api);
    for (const path of ['/', '/disclosures', '/login']) {
      await page.goto(path);
      const html = await page.content();
      expect(html).not.toContain(trade.ref);
      expect(html).not.toMatch(/win rate|\d+% accura|guaranteed profit/i);
    }
    await page.goto('/');
    await expect(page.getByText(/does not place trades/).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Please read this first' })).toBeVisible();
  });

  test('client bundles contain no secrets or signal data', async ({ page }) => {
    const urls: string[] = [];
    page.on('response', (r) => {
      if (r.url().endsWith('.js')) urls.push(r.url());
    });
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      const body = await (await page.request.get(url)).text();
      expect(body).not.toMatch(/APP_ENCRYPTION_KEY|VAPID_PRIVATE_KEY|DATABASE_URL=/);
    }
  });

  test('sends a strict content security policy', async ({ page }) => {
    const res = await page.goto('/login');
    const csp = res?.headers()['content-security-policy'] ?? '';
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toMatch(/script-src 'self' 'nonce-/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(res?.headers()['x-frame-options']).toBe('DENY');
  });
});

test.describe('subscribers', () => {
  test('are turned away from the admin area, and the API refuses too', async ({ page }) => {
    const api = await adminApi();
    const sub = await createSubscriberViaApi(api);
    await signInFirstTime(page, sub);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/app$/);
    await page.goto('/admin/subscribers');
    await expect(page).toHaveURL(/\/app$/);
    for (const path of [
      '/api/v1/admin/dashboard',
      '/api/v1/admin/subscribers',
      '/api/v1/admin/performance',
      '/api/v1/admin/audit',
    ]) {
      expect((await page.request.get(path)).status()).toBe(403);
    }
    const write = await page.request.post('/api/v1/admin/signals', {
      headers: { origin: WEB_ORIGIN },
      data: {},
    });
    expect(write.status()).toBe(403);
  });

  test('cannot read a session token from page scripts or storage', async ({ page }) => {
    const api = await adminApi();
    const sub = await createSubscriberViaApi(api);
    await signInFirstTime(page, sub);
    const exposed = await page.evaluate(() => ({
      cookie: document.cookie,
      local: JSON.stringify(localStorage),
      session: JSON.stringify(sessionStorage),
    }));
    expect(exposed.cookie).not.toContain('sd_session');
    expect(exposed.local).not.toMatch(/token|password/i);
    expect(exposed.session).not.toMatch(/token|password/i);
  });

  test('a signal comment is rendered as text, never as markup', async ({ page }) => {
    const api = await adminApi();
    const sub = await createSubscriberViaApi(api);
    await signInFirstTime(page, sub);
    await page.goto('/app/alerts');
    let fired = false;
    page.on('dialog', async (dialog) => {
      fired = true;
      await dialog.dismiss();
    });
    const payload = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const trade = await publishViaApi(api, undefined, { commentary: payload });
    await expect(page.getByText(payload).first()).toBeVisible();
    await page.goto(`/app/trades/${trade.id}`);
    await expect(page.getByText(payload, { exact: false }).first()).toBeVisible();
    expect(fired).toBe(false);
    expect(await page.locator('img[src="x"]').count()).toBe(0);
  });
});

test.describe('administrators', () => {
  test.use({ storageState: ADMIN_STATE });

  test('a sign-out link followed from elsewhere cannot redirect off-site', async ({ page, context }) => {
    await context.clearCookies();
    await page.goto('/login?next=https://evil.example/phish');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    const html = await page.content();
    expect(html).not.toContain('href="https://evil.example');
  });
});
