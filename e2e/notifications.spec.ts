import { createECDH, randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { adminApi, createSubscriberViaApi, signInFirstTime } from './helpers.js';

/**
 * Real Chromium, real service worker, real Notification API and real permission handling. Headless
 * Chromium cannot obtain a subscription from a real push service, so that one call is stubbed, and the
 * push itself is injected through the DevTools protocol. What the operating system then draws is outside
 * this test: on a headless machine there is no notification centre, so the call to showNotification is
 * what gets checked. Sending with real encryption is covered separately by the API integration tests.
 */
// Closest thing to real Chrome: the bare headless shell has no working notification permission.
test.use({ channel: 'chromium' });

test.describe('notifications in the browser', () => {
  test('turning on notifications registers this device, and it can be turned off', async ({ page, context }) => {
    await context.grantPermissions(['notifications']);
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const keys = { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') };
    const endpoint = `https://localhost:9/device/${randomBytes(6).toString('hex')}`;
    await page.addInitScript(
      ({ endpoint: url, keys: k }) => {
        // Survives a reload, as a browser's real subscription does.
        const held = () => localStorage.getItem('test-push') === '1';
        const fake = {
          endpoint: url,
          toJSON: () => ({ endpoint: url, keys: k }),
          unsubscribe: async () => {
            localStorage.removeItem('test-push');
            return true;
          },
        };
        PushManager.prototype.subscribe = async function () {
          localStorage.setItem('test-push', '1');
          return fake as unknown as PushSubscription;
        };
        PushManager.prototype.getSubscription = async function () {
          return (held() ? fake : null) as PushSubscription | null;
        };
      },
      { endpoint, keys },
    );
    const api = await adminApi();
    const sub = await createSubscriberViaApi(api);
    await signInFirstTime(page, sub);
    await page.goto('/app/account');
    const card = page.locator('#notifications');
    await expect(card.getByText('Off for this device')).toBeVisible();
    await card.getByRole('button', { name: 'Turn on notifications' }).click();
    await expect(card.getByText('On for this device')).toBeVisible();
    await expect(card.getByText(/Chrome on .*\(this one\)/)).toBeVisible();

    await card.getByRole('switch', { name: /Hide details on the lock screen/ }).click();
    await expect(card.getByRole('switch', { name: /Hide details on the lock screen/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.reload();
    await expect(
      page.locator('#notifications').getByRole('switch', { name: /Hide details on the lock screen/ }),
    ).toHaveAttribute('aria-checked', 'true');

    await page.locator('#notifications').getByRole('button', { name: 'Turn off on this device' }).click();
    await expect(page.locator('#notifications').getByText('Off for this device')).toBeVisible();
    const devices = await (await page.request.get('/api/v1/push/devices')).json();
    expect(devices.devices).toHaveLength(0);
  });

  test('the service worker shows a pushed message, and no prompt appears without a click', async ({
    page,
    context,
    baseURL,
  }) => {
    let prompted = false;
    await page.exposeFunction('reportPrompt', () => {
      prompted = true;
    });
    await page.addInitScript(() => {
      const original = Notification.requestPermission.bind(Notification);
      Notification.requestPermission = (...args) => {
        (window as unknown as { reportPrompt: () => void }).reportPrompt();
        return original(...args);
      };
    });
    await context.grantPermissions(['notifications']);
    const api = await adminApi();
    const sub = await createSubscriberViaApi(api);
    await signInFirstTime(page, sub);
    await page.goto('/app/alerts');
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
    });
    expect(prompted).toBe(false);

    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await worker.evaluate(() => {
      const scope = globalThis as unknown as { shown: unknown[]; registration: ServiceWorkerRegistration };
      scope.shown = [];
      scope.registration.showNotification = async (title: string, options?: NotificationOptions) => {
        scope.shown.push({
          title,
          body: options?.body,
          tag: options?.tag,
          data: options?.data,
          requireInteraction: options?.requireInteraction,
        });
      };
    });

    const client = await context.newCDPSession(page);
    const registrationId = await new Promise<string>((resolve) => {
      client.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
        const found = registrations.find((r: { isDeleted: boolean }) => !r.isDeleted);
        if (found) resolve(found.registrationId);
      });
      void client.send('ServiceWorker.enable');
    });
    const deliver = (data: string) =>
      client.send('ServiceWorker.deliverPushMessage', { origin: baseURL as string, registrationId, data });
    const shown = () => worker.evaluate(() => (globalThis as unknown as { shown: unknown[] }).shown);

    await deliver(
      JSON.stringify({
        title: 'New signal: BUY XAU/USD',
        body: 'Entry: 3,300.00',
        url: '/app/trades/abc',
        tag: 'event-1',
        urgent: true,
      }),
    );
    // The tag is the event id: a repeat of one event replaces its notification instead of stacking.
    await expect.poll(shown).toContainEqual({
      title: 'New signal: BUY XAU/USD',
      body: 'Entry: 3,300.00',
      tag: 'event-1',
      data: { url: '/app/trades/abc' },
      requireInteraction: true,
    });

    // A payload the worker cannot read still alerts, with neutral words and no invented content.
    await deliver('not json');
    await expect.poll(shown).toContainEqual({
      title: 'New update',
      body: 'Open the app to read it.',
      tag: 'update',
      data: { url: '/app' },
      requireInteraction: false,
    });
  });

  test('the service worker never caches private responses', async ({ page }) => {
    const api = await adminApi();
    const sub = await createSubscriberViaApi(api);
    await signInFirstTime(page, sub);
    await page.goto('/app');
    await expect(page.getByRole('heading', { name: 'Signals' })).toBeVisible();
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Signals' })).toBeVisible();
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const urls: string[] = [];
      for (const name of names)
        urls.push(...(await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname));
      return urls;
    });
    expect(cached).toEqual(['/offline.html']);
  });

  test('when offline, navigation shows the offline page and no stored signals', async ({ page, context }) => {
    const api = await adminApi();
    const sub = await createSubscriberViaApi(api);
    await signInFirstTime(page, sub);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Signals' })).toBeVisible();
    await context.setOffline(true);
    await page.goto('/app/history').catch(() => undefined);
    await expect(page.getByRole('heading', { name: 'You are offline' })).toBeVisible();
    await context.setOffline(false);
  });
});
