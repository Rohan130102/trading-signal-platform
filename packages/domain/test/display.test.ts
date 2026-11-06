import { describe, expect, it } from 'vitest';
import {
  accessEndedCopy,
  androidChannelFor,
  basisShort,
  categoryLabel,
  formatLocalDate,
  isSafeDeepLink,
  mobileDeepLinkPath,
  money,
  percent,
  relativeTime,
  signedPoints,
} from '../src/index.js';

describe('shared display helpers', () => {
  it('signs points and money the same way everywhere', () => {
    expect(signedPoints('150')).toBe('+150 pts');
    expect(signedPoints('-40')).toBe('-40 pts');
    expect(signedPoints('0')).toBe('0 pts');
    expect(money('1234.5', 'USD')).toBe('1,234.50 USD');
    expect(money('-1234.5', 'USD')).toBe('−1,234.50 USD');
    expect(money('0', 'USD')).toBe('0.00 USD');
    expect(percent('0.3333', 1)).toBe('33.3%');
  });

  it('never leaves a figure without its basis', () => {
    expect(basisShort('HYPOTHETICAL_OUTCOME')).toBe('hypothetical');
    expect(basisShort('ADMIN_DECLARED_EXECUTION')).toContain('unverified');
  });

  it('reports recent times relatively, and hands older ones back', () => {
    const now = Date.parse('2026-11-05T12:00:00Z');
    expect(relativeTime('2026-11-05T11:59:50Z', now)).toBe('just now');
    expect(relativeTime('2026-11-05T11:50:00Z', now)).toBe('10m ago');
    expect(relativeTime('2026-11-05T09:00:00Z', now)).toBe('3h ago');
    expect(relativeTime('2026-11-03T12:00:00Z', now)).toBe('2d ago');
    expect(relativeTime('2026-10-01T12:00:00Z', now)).toBeNull();
  });
});

describe('notification routing', () => {
  it('sends new signals and anything priority to the loudest channel', () => {
    expect(androidChannelFor('NEW_SIGNAL', 'NORMAL')).toBe('signals');
    expect(androidChannelFor('UPDATE', 'PRIORITY')).toBe('signals');
    expect(androidChannelFor('UPDATE', 'NORMAL')).toBe('updates');
    expect(androidChannelFor('CLOSURE', 'NORMAL')).toBe('updates');
    expect(androidChannelFor('ANNOUNCEMENT', 'NORMAL')).toBe('announcements');
  });

  it('only opens known places from a notification', () => {
    expect(isSafeDeepLink('/feed')).toBe(true);
    expect(isSafeDeepLink('/account')).toBe(true);
    expect(isSafeDeepLink('/trades/8f14e45f-ceea-467f-a8f1-6f9d3b1c2a10')).toBe(true);
    for (const bad of [
      '/admin/dashboard',
      'https://evil.example',
      '//evil.example',
      '/trades/../admin',
      '/trades/1',
      null,
      7,
    ]) {
      expect(isSafeDeepLink(bad)).toBe(false);
    }
  });

  it('deep-links to the trade, or the feed when there is none', () => {
    expect(mobileDeepLinkPath('abc')).toBe('/trades/abc');
    expect(mobileDeepLinkPath(null)).toBe('/feed');
  });
});

describe('shared wording', () => {
  const me = (reason: string | null, extra: object = {}) =>
    ({
      access: { allowed: false, reason },
      subscription: { lastValidDate: '2026-11-30', startsAt: null },
      ...extra,
    }) as never;

  it('explains each way access can be missing', () => {
    expect(accessEndedCopy(me('SUBSCRIPTION_EXPIRED')).title).toBe('Your subscription has ended');
    expect(accessEndedCopy(me('SUBSCRIPTION_EXPIRED')).body).toContain('2026');
    expect(accessEndedCopy(me('SUBSCRIPTION_SCHEDULED')).title).toContain('not started');
    expect(accessEndedCopy(me('ACCOUNT_DISABLED')).title).toContain('not active');
    expect(accessEndedCopy(me('SUBSCRIPTION_NONE')).title).toBe('No subscription yet');
  });

  it('says whether something is new or changes an existing trade', () => {
    expect(categoryLabel('NEW_SIGNAL', 'T-1')).toBe('New signal');
    expect(categoryLabel('UPDATE', 'T-1')).toBe('Update to T-1');
    expect(categoryLabel('CLOSURE', 'T-1')).toBe('Closed: T-1');
    expect(categoryLabel('ANNOUNCEMENT')).toBe('Announcement');
  });

  it('formats a calendar date without shifting it by timezone', () => {
    expect(formatLocalDate('2026-03-01')).toContain('2026');
    expect(formatLocalDate('2026-03-01')).toMatch(/March|Mar/);
  });
});
