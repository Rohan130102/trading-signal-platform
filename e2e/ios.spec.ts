import { expect, test } from '@playwright/test';
import { adminApi, createSubscriberViaApi, signInFirstTime } from './helpers.js';

test('iPhone in a browser tab gets Add to Home Screen guidance, not a dead button', async ({ page }) => {
  const api = await adminApi();
  const sub = await createSubscriberViaApi(api);
  await signInFirstTime(page, sub);
  await expect(page.getByText('Want alerts on your iPhone?')).toBeVisible();
  await page.getByRole('link', { name: 'Show me how' }).click();
  await expect(page.getByText(/add this app to your Home Screen first/)).toBeVisible();
  await expect(page.getByText(/Choose .Add to Home Screen./)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Turn on notifications' })).toHaveCount(0);
  await expect(page.getByText(/Phone alerts can arrive late/)).toBeVisible();
});
