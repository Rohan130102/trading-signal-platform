import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type APIRequestContext, type Browser, type Page, expect, request } from '@playwright/test';
import { WEB_ORIGIN } from './ports.js';

export const ADMIN_STATE = resolve(import.meta.dirname, '.auth/admin.json');
export const PASSWORD = 'a-long-subscriber-passphrase';
const BASE = WEB_ORIGIN;

export function adminState(): { login: string; temp: string; databaseUrl: string } {
  return JSON.parse(readFileSync(resolve(import.meta.dirname, '.state/admin.json'), 'utf8'));
}

export async function adminApi(): Promise<APIRequestContext> {
  return request.newContext({ baseURL: BASE, storageState: ADMIN_STATE, extraHTTPHeaders: { origin: BASE } });
}

let counter = 0;
export const uniqueLogin = (prefix = 'user') => {
  counter += 1;
  return `${prefix}.${Date.now().toString(36)}.${counter}`.toLowerCase();
};

// Every call uses a fresh price, so tests do not trigger the duplicate-signal warning by accident.
let price = 2000 + Math.floor(Math.random() * 300_000) * 2;
export const nextPrice = () => {
  price += 13;
  return price;
};

export async function instrumentId(api: APIRequestContext, symbol = 'XAU/USD'): Promise<string> {
  const res = await api.get('/api/v1/admin/instruments');
  const body = (await res.json()) as { instruments: { id: string; symbol: string }[] };
  return (body.instruments.find((i) => i.symbol === symbol) as { id: string }).id;
}

export async function publishViaApi(api: APIRequestContext, entry = nextPrice(), fields: Record<string, unknown> = {}) {
  const res = await api.post('/api/v1/admin/signals', {
    data: {
      instrumentId: await instrumentId(api),
      direction: 'BUY',
      entryType: 'SINGLE',
      entryLow: String(entry),
      entryHigh: String(entry),
      targets: [String(entry + 150)],
      stopLoss: String(entry - 180),
      idempotencyKey: randomUUID(),
      // The older flow, so lifecycle tests can activate explicitly. Publishing activates at once by default.
      activateOnPublish: false,
      ...fields,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { trade: TradeBody }).trade;
}

export interface TradeBody {
  id: string;
  ref: string;
  version: number;
  stopLoss: string;
  entryLow: string;
  status: string;
}

export async function actViaApi(
  api: APIRequestContext,
  trade: { id: string; version: number },
  action: string,
  fields: Record<string, unknown> = {},
) {
  const res = await api.post(`/api/v1/admin/trades/${trade.id}/events`, {
    data: { action, expectedVersion: trade.version, idempotencyKey: randomUUID(), ...fields },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { trade: TradeBody }).trade;
}

export interface Sub {
  id: string;
  loginId: string;
  temporaryPassword: string;
}

export async function createSubscriberViaApi(api: APIRequestContext, days = 30): Promise<Sub> {
  const loginId = uniqueLogin();
  const res = await api.post('/api/v1/admin/subscribers', {
    data: { name: 'Test Person', loginId, durationDays: days, idempotencyKey: randomUUID() },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { subscriber: { id: string }; temporaryPassword: string };
  return { id: body.subscriber.id, loginId, temporaryPassword: body.temporaryPassword };
}

/** The real first-time path through the UI. */
export async function signInFirstTime(page: Page, sub: Sub): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email or username').fill(sub.loginId);
  await page.getByLabel('Password', { exact: true }).fill(sub.temporaryPassword);
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose your password' })).toBeVisible();
  await page.getByLabel('Temporary password').fill(sub.temporaryPassword);
  await page.getByLabel('New password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('New password again').fill(PASSWORD);
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page).toHaveURL(/\/app$/);
}

export async function subscriberPage(
  browser: Browser,
  sub: Sub,
  options: Parameters<Browser['newContext']>[0] = {},
): Promise<Page> {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await signInFirstTime(page, sub);
  return page;
}

export const expireSubscriber = (api: APIRequestContext, id: string) =>
  api.post(`/api/v1/admin/subscribers/${id}/adjust`, {
    data: {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      activationDate: '2026-01-01',
      note: 'E2E expiry',
      idempotencyKey: randomUUID(),
    },
  });
