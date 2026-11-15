import { expect, type Page, test } from '@playwright/test';

/* The public way in: the landing page, Log In, and Create Account with its email code. */

test('the landing page explains the service and leads to Create Account and Log In', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Trade signals');
  await expect(page.getByText('Signals only. We never place trades for you.')).toBeVisible();
  await expect(page.getByText('Example for illustration. Not a real trade.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible();
  const site = page.getByRole('navigation', { name: 'Site' });
  // One name for signing up, everywhere.
  await expect(site.getByRole('link', { name: 'Create Account' })).toHaveAttribute('href', '/signup');
  await expect(page.getByText('Sign Up', { exact: true })).toHaveCount(0);
  await site.getByRole('link', { name: 'Log In' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('Log In has one way to create an account, email or username and a visible password', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Account' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Create Account' })).toHaveAttribute('href', '/signup');
  await expect(page.getByLabel('Email or username')).toBeVisible();
  const password = page.getByLabel('Password', { exact: true });
  await password.fill('secret-words');
  await expect(password).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: /show password/i }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(page.getByRole('link', { name: 'Forgot Password?' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'About us' }).first()).toBeAttached();
});

async function fillDetails(page: Page) {
  await page.getByLabel('First name').fill('Asha');
  await page.getByLabel('Last name').fill('Rao');
  await page.getByLabel('Email address').fill('asha.rao@example.test');
  await page.getByLabel('Mobile number').fill('98765 43210');
  await page.getByLabel('Age').fill('34');
  await page.getByRole('checkbox').check();
}

test('Create Account asks for details first; when no code can be emailed, the details go to the team on WhatsApp', async ({
  page,
}) => {
  // The test server has no email set up, so it cannot send a sign-up code.
  await page.goto('/signup');
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await expect(page.getByText('Step 1 of 3')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Enter your first name')).toBeVisible();

  await fillDetails(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'We could not send your code' })).toBeVisible();
  await expect(page.getByText('asha.rao@example.test')).toBeVisible();
  await expect(page.getByText('+919876543210')).toBeVisible();
  const whatsapp = page.getByRole('link', { name: 'Send my details on WhatsApp' });
  const href = (await whatsapp.getAttribute('href')) ?? '';
  expect(href).toMatch(/^https:\/\/wa\.me\/\d+\?text=/);
  const text = decodeURIComponent(href.split('text=')[1] ?? '');
  expect(text).toContain('Name: Asha Rao');
  expect(text).toContain('Email: asha.rao@example.test');
  expect(text).toContain('Mobile: +919876543210');
  await expect(page.getByRole('link', { name: 'Email them instead' })).toHaveAttribute('href', /^mailto:/);

  // Nothing typed is lost on the way back.
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByLabel('Email address')).toHaveValue('asha.rao@example.test');
  await expect(page.getByLabel('First name')).toHaveValue('Asha');
});

test('Create Account goes details, email code, password, then contact with the team (server answers stubbed)', async ({
  page,
}) => {
  // The screens only: the server side of each step is covered by the API's registration tests.
  const challenge = {
    challengeId: '7f0c1f9e-8a52-4a2b-9d4e-2f6d7a1c3b10',
    email: 'asha.rao@example.test',
    resendAvailableAt: new Date(Date.now() + 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
  };
  const sent: string[] = [];
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/auth/register'),
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      sent.push(path);
      const body =
        path === '/api/v1/auth/register'
          ? challenge
          : path === '/api/v1/auth/register/verify'
            ? { setupToken: 'stub-token', expiresAt: challenge.expiresAt }
            : { email: challenge.email };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    },
  );

  await page.goto('/signup');
  await fillDetails(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Verify Email' })).toBeVisible();
  await expect(page.getByText('Step 2 of 3')).toBeVisible();

  // Going back to change the address keeps the rest.
  await page.getByRole('button', { name: 'Change email' }).click();
  await expect(page.getByLabel('Last name')).toHaveValue('Rao');
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByLabel('Verification code').fill('123456');
  await page.getByRole('button', { name: 'Verify Email' }).click();
  await expect(page.getByRole('heading', { name: 'Create Password' })).toBeVisible();
  await expect(page.getByText('Step 3 of 3')).toBeVisible();
  await page.getByLabel('Create password').fill('a-long-new-passphrase-42');
  await page.getByLabel('Confirm password').fill('a-long-new-passphrase-42');
  await page.getByRole('button', { name: 'Create Account' }).click();

  await expect(page.getByRole('heading', { name: 'Account Created Successfully' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send Subscription Enquiry to Support' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Email Support Instead' })).toBeVisible();
  expect(sent).toEqual([
    '/api/v1/auth/register',
    '/api/v1/auth/register',
    '/api/v1/auth/register/verify',
    '/api/v1/auth/register/complete',
  ]);
});

test('what is typed or autofilled before the page has finished loading is still used to log in', async ({ page }) => {
  // On a slow connection the fields appear before the page's scripts run, and people (or password managers) fill
  // them in. Holding the scripts back recreates that.
  let release = () => {};
  const scripts = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/_next/static/chunks/**/*.js', async (route) => {
    await scripts;
    await route.continue();
  });
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email or username').fill('nobody.here');
  const password = page.getByLabel('Password', { exact: true });
  await password.fill('wrong-password');
  release();
  // The page is ready once its own controls respond.
  await expect(async () => {
    await page.getByRole('button', { name: /show password/i }).click();
    await expect(password).toHaveAttribute('type', 'text', { timeout: 500 });
  }).toPass();
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'That email, username or password is not right.' }),
  ).toBeVisible();
  await expect(page.getByText('Enter your email or username')).toHaveCount(0);
});

test('sign-up details typed before the page has finished loading are kept', async ({ page }) => {
  let release = () => {};
  const scripts = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/_next/static/chunks/**/*.js', async (route) => {
    await scripts;
    await route.continue();
  });
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await fillDetails(page);
  // The page asks for the service's details as soon as it is interactive.
  const ready = page.waitForResponse('**/api/v1/public/info');
  release();
  await ready;
  await page.getByRole('button', { name: 'Continue' }).click();
  // The test server sends no email, so the details are offered to the team instead: all of them arrived.
  await expect(page.getByRole('heading', { name: 'We could not send your code' })).toBeVisible();
  await expect(page.getByText('asha.rao@example.test')).toBeVisible();
  await expect(page.getByText('+919876543210')).toBeVisible();
});
