import { expect, test } from '@playwright/test';
import { ADMIN_STATE, adminApi, createSubscriberViaApi } from './helpers.js';

test.use({ storageState: ADMIN_STATE });

/* The Super Admin's configuration screen, and free days for a member who already pays. */

test('the email account is set up from the screen, and a failed test says why', async ({ page }) => {
  const api = await adminApi();
  try {
    await page.goto('/admin/settings?tab=email');
    await expect(page.getByRole('heading', { name: 'Configuration' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Email' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Email is not set up')).toBeVisible();

    await page.getByRole('radio', { name: 'Other' }).check({ force: true });
    await page.getByRole('switch', { name: /Send email from this account/ }).click();
    await page.getByLabel('Sender name').fill('Signal Desk');
    await page.getByLabel('Email address').fill('desk@example.test');
    await page.getByLabel('Password', { exact: true }).fill('app-password-1234');
    await page.getByLabel('SMTP server').fill('127.0.0.1');
    await page.getByLabel('Port').fill('1');
    await page.getByLabel('Username').fill('desk@example.test');
    await page.getByRole('button', { name: 'Save email settings' }).click();
    await expect(page.getByText('Email is working')).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('placeholder', /Saved/);

    await page.getByLabel('Send the test to').fill('owner@example.test');
    await page.getByRole('button', { name: 'Send test email' }).click();
    await expect(page.getByText(/Could not connect to 127\.0\.0\.1 on port 1/)).toBeVisible();
  } finally {
    // Back to no email, so the rest of the suite sees sign-up as it was.
    const res = await api.put('/api/v1/admin/settings/email', {
      data: {
        enabled: false,
        host: '',
        port: 587,
        security: 'STARTTLS',
        username: '',
        fromName: '',
        fromAddress: '',
      },
    });
    expect(res.status()).toBe(200);
  }
});

test('sign-up can be paused, and the sign-up screen says so', async ({ page, browser }) => {
  const api = await adminApi();
  try {
    await page.goto('/admin/settings?tab=signup');
    await page.getByRole('switch', { name: /Allow new sign-ups/ }).click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Configuration saved')).toBeVisible();
    const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const signup = await visitor.newPage();
    await signup.goto('/signup');
    await expect(signup.getByRole('heading', { name: 'Sign-up is paused' })).toBeVisible();
    await visitor.close();
  } finally {
    const current = await (await api.get('/api/v1/admin/settings')).json();
    const { id: _i, updatedAt: _u, dataResetAt: _r, ...fields } = current;
    expect((await api.put('/api/v1/admin/settings', { data: { ...fields, signupOpen: true } })).status()).toBe(200);
  }
});

test('a member who already pays can be given free days, added after their paid days', async ({ page }) => {
  const api = await adminApi();
  const sub = await createSubscriberViaApi(api, 30);
  await page.goto(`/admin/subscribers/${sub.id}`);
  await page.getByRole('button', { name: 'Grant Free Trial' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/They already have access/)).toBeVisible();
  await dialog.getByLabel('Duration (days)').fill('7');
  await dialog.getByRole('button', { name: 'Add 7 free days' }).click();
  await expect(page.getByText(/Free days added/)).toBeVisible();
  const detail = (await (await api.get(`/api/v1/admin/subscribers/${sub.id}`)).json()) as {
    subscription: { daysRemaining: number; kind: string };
  };
  expect(detail.subscription).toMatchObject({ daysRemaining: 37, kind: 'PAID' });
});
