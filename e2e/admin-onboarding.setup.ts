import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test as setup } from '@playwright/test';
import { generate } from 'otplib';
import { ADMIN_STATE, adminState } from './helpers.js';

/** The first administrator's real path: temporary password, new password, MFA, recovery codes. */
setup('administrator first sign-in', async ({ page }) => {
  const { login, temp } = adminState();
  await page.goto('/login');
  await page.getByLabel('Email or username').fill(login);
  await page.getByLabel('Password', { exact: true }).fill(temp);
  await page.getByRole('button', { name: 'Log In', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Choose your password' })).toBeVisible();
  await page.getByLabel('Temporary password').fill(temp);
  await page.getByLabel('New password', { exact: true }).fill('quiet-river-stone-lamp');
  await page.getByLabel('New password again').fill('quiet-river-stone-lamp');
  await page.getByRole('button', { name: 'Save password' }).click();

  await expect(page.getByRole('heading', { name: 'Set up two-step verification' })).toBeVisible();
  await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible();
  await page.getByText('Cannot scan it?').click();
  const secret = (await page.locator('code').first().textContent()) as string;
  writeFileSync(resolve(import.meta.dirname, '.state/mfa.txt'), secret.trim());
  await page.getByLabel('Six-digit code').fill(await generate({ secret: secret.trim() }));
  await page.getByRole('button', { name: 'Turn on' }).click();

  await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
  await expect(page.locator('li').first()).toHaveText(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  await page.getByRole('button', { name: 'I have saved them' }).click();

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await page.context().storageState({ path: ADMIN_STATE });
});
