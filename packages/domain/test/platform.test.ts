import { describe, expect, it } from 'vitest';
import {
  createAdminSchema,
  entryWindowLabel,
  announcementVisibleToMember,
  entitlementPeriods,
  removeTradesSchema,
  resolveEntryExpiry,
  screenshotsAllowedFor,
  settingsSchema,
  startsActive,
  visibleToMember,
} from '../src/index.js';

const NOW = new Date('2026-11-09T10:00:00Z');

describe('signal start', () => {
  it('an explicit choice wins over the platform mode', () => {
    expect(startsActive(undefined, 'AWAITING_ENTRY')).toBe(false);
    expect(startsActive(undefined, 'ACTIVE')).toBe(true);
    expect(startsActive(true, 'AWAITING_ENTRY')).toBe(true);
    expect(startsActive(false, 'ACTIVE')).toBe(false);
  });

  it('the entry window: explicit, none, or the platform default; never for a signal that starts active', () => {
    expect(resolveEntryExpiry(undefined, 240, false, NOW)?.toISOString()).toBe('2026-11-09T14:00:00.000Z');
    expect(resolveEntryExpiry(undefined, 0, false, NOW)).toBeNull();
    expect(resolveEntryExpiry(null, 240, false, NOW)).toBeNull();
    expect(resolveEntryExpiry('2026-11-09T10:30:00Z', 240, false, NOW)?.toISOString()).toBe('2026-11-09T10:30:00.000Z');
    expect(resolveEntryExpiry('2026-11-09T10:30:00Z', 240, true, NOW)).toBeNull();
  });

  it('labels windows in words', () => {
    expect(entryWindowLabel(0)).toBe('No limit');
    expect(entryWindowLabel(15)).toBe('15 min');
    expect(entryWindowLabel(90)).toBe('1 h 30 min');
    expect(entryWindowLabel(1440)).toBe('1 day');
    expect(entryWindowLabel(2 * 1440 + 60)).toBe('2 days 1 h');
  });
});

describe('screenshots', () => {
  it("a subscriber's own setting wins over the platform default", () => {
    expect(screenshotsAllowedFor(null, false)).toBe(false);
    expect(screenshotsAllowedFor(undefined, true)).toBe(true);
    expect(screenshotsAllowedFor(true, false)).toBe(true);
    expect(screenshotsAllowedFor(false, true)).toBe(false);
  });
});

describe('entitlement periods', () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const change = (at: string, startsAt: string, expiresAt: string) => ({
    at: d(at),
    startsAt: d(startsAt),
    expiresAt: d(expiresAt),
  });

  it('keeps a lapse between two memberships out, and keeps both memberships', () => {
    // Nov 1-10, expired Nov 11-14, renewed Nov 15-30.
    const periods = entitlementPeriods([
      change('2026-11-01', '2026-11-01', '2026-11-11'),
      change('2026-11-15', '2026-11-15', '2026-12-01'),
    ]);
    expect(periods).toEqual([
      { from: d('2026-11-01'), to: d('2026-11-11') },
      { from: d('2026-11-15'), to: d('2026-12-01') },
    ]);
    const trade = (publishedAt: string) => ({ publishedAt: d(publishedAt) });
    expect(visibleToMember(trade('2026-11-05'), periods)).toBe(true);
    expect(visibleToMember(trade('2026-11-12'), periods)).toBe(false);
    expect(visibleToMember(trade('2026-11-16'), periods)).toBe(true);
    expect(visibleToMember(trade('2026-10-30'), periods)).toBe(false);
  });

  it('joins a renewal made while the membership was running', () => {
    const periods = entitlementPeriods([
      change('2026-11-01', '2026-11-01', '2026-11-11'),
      change('2026-11-05', '2026-11-01', '2026-12-11'),
    ]);
    expect(periods).toEqual([{ from: d('2026-11-01'), to: d('2026-12-11') }]);
  });

  it('ends a window early when a later change shortened it', () => {
    const periods = entitlementPeriods([
      change('2026-11-01', '2026-11-01', '2026-12-01'),
      change('2026-11-10', '2026-11-01', '2026-11-10'),
    ]);
    expect(periods).toEqual([{ from: d('2026-11-01'), to: d('2026-11-10') }]);
  });

  it('uses the current window when no change was recorded, and nothing without one', () => {
    expect(entitlementPeriods([], { startsAt: d('2026-11-01'), expiresAt: d('2026-11-08') })).toEqual([
      { from: d('2026-11-01'), to: d('2026-11-08') },
    ]);
    expect(entitlementPeriods([], null)).toEqual([]);
    expect(visibleToMember({ publishedAt: d('2026-11-02') }, [])).toBe(false);
  });

  it('administrators have no restriction', () => {
    expect(visibleToMember({ publishedAt: d('2020-01-01') }, null)).toBe(true);
  });

  it('applies the same rule to announcements, except notices about the service', () => {
    const periods = [{ from: d('2026-11-15'), to: d('2026-12-01') }];
    expect(announcementVisibleToMember({ category: 'MARKET_UPDATE', publishedAt: d('2026-11-13') }, periods)).toBe(
      false,
    );
    expect(announcementVisibleToMember({ category: 'GENERAL', publishedAt: d('2026-11-16') }, periods)).toBe(true);
    expect(announcementVisibleToMember({ category: 'MAINTENANCE', publishedAt: d('2026-11-13') }, periods)).toBe(true);
  });
});

describe('requests', () => {
  it('a removal needs the typed confirmation and a reason', () => {
    const base = {
      tradeIds: ['6f9619ff-8b86-4011-b42d-00c04fc964ff'],
      expectedCount: 1,
      reason: 'Test signal',
      confirm: 'REMOVE',
    };
    expect(removeTradesSchema.safeParse(base).success).toBe(true);
    expect(removeTradesSchema.safeParse({ ...base, confirm: 'remove' }).success).toBe(false);
    expect(removeTradesSchema.safeParse({ ...base, reason: 'bad' }).success).toBe(false);
  });

  it('an administrator needs a usable login ID', () => {
    const key = '6f9619ff-8b86-4011-b42d-00c04fc964ff';
    expect(createAdminSchema.safeParse({ name: 'A', loginId: 'desk.one', idempotencyKey: key }).success).toBe(true);
    expect(createAdminSchema.safeParse({ name: 'A', loginId: 'no spaces', idempotencyKey: key }).success).toBe(false);
  });

  it('an entry window is zero (no limit) or at least five minutes', () => {
    const base = {
      serviceName: 'SignalDesk',
      businessTimezone: 'Asia/Kolkata',
      supportContact: '',
      renewalInstructions: '',
      legalEntityName: '',
      regulatoryStatement: '',
      riskDisclosure: '',
      privacyNotice: '',
      serviceDescription: '',
      aboutBody: '',
      signalStartMode: 'AWAITING_ENTRY',
      entryExpiryMinutesDefault: 240,
      trailingStopWording: 'GENERAL',
      screenshotsAllowedDefault: false,
      historyScope: 'MEMBERSHIP',
    };
    expect(settingsSchema.safeParse(base).success).toBe(true);
    expect(settingsSchema.safeParse({ ...base, entryExpiryMinutesDefault: 0 }).success).toBe(true);
    expect(settingsSchema.safeParse({ ...base, entryExpiryMinutesDefault: 4 }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...base, signalStartMode: 'LATER' }).success).toBe(false);
  });
});
