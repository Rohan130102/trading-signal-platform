import { expect, test } from '@playwright/test';

/* The public way in: the landing page, Log In / Sign Up, and what sign-up says when it cannot take anyone yet. */

test('the landing page explains the service and leads to sign-up and log-in', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Trade signals');
  await expect(page.getByText('Signals only. We never place trades for you.')).toBeVisible();
  await expect(page.getByText('Example for illustration. Not a real trade.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: 'Log In' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('Log In and Sign Up are two clear tabs, with email or username and a visible password', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(
    page
      .getByRole('link', { name: 'Log In', exact: true })
      .or(page.getByRole('tab', { name: 'Log In' }))
      .first(),
  ).toBeVisible();
  await expect(page.getByLabel('Email or username')).toBeVisible();
  const password = page.getByLabel('Password', { exact: true });
  await password.fill('secret-words');
  await expect(password).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: /show password/i }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(page.getByRole('link', { name: 'Forgot Password?' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'About us' }).first()).toBeAttached();
});

test('sign-up says it cannot take new accounts yet, before anything is typed, and how to reach the team', async ({
  page,
}) => {
  // The test server sends no email, so a sign-up code could not be delivered.
  await page.goto('/signup');
  await expect(page.getByRole('heading', { name: 'Sign-up opens soon' })).toBeVisible();
  await expect(page.getByLabel('First name')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Message us on WhatsApp' })).toHaveAttribute(
    'href',
    /^https:\/\/wa\.me\/\d+$/,
  );
  await expect(page.getByRole('link', { name: /^Email / })).toHaveAttribute('href', /^mailto:/);
});
