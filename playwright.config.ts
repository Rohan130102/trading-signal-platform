import { defineConfig, devices } from '@playwright/test';
import { WEB_ORIGIN } from './e2e/ports.js';

/**
 * Runs against production builds and a real PostgreSQL. Build first: npm run build
 * Local browsers: PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install chromium webkit
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  // One shared stack and database, so tests that change global state cannot interfere.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e.json' }]],
  use: {
    baseURL: WEB_ORIGIN,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /admin-onboarding\.setup\.ts/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'desktop',
      dependencies: ['setup'],
      testMatch: /\.spec\.ts$/,
      testIgnore: /ios\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 900 } },
    },
    {
      name: 'mobile',
      dependencies: ['setup'],
      testMatch: /(subscriber|expiry|responsive|a11y)\.spec\.ts$/,
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'iphone',
      dependencies: ['setup'],
      testMatch: /(subscriber|ios)\.spec\.ts$/,
      use: { ...devices['iPhone 14'] },
    },
  ],
});
