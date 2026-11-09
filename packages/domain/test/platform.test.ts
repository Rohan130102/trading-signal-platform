import { describe, expect, it } from 'vitest';
import {
  createAdminSchema,
  entryWindowLabel,
  membershipStart,
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

describe('membership history', () => {
  const from = new Date('2026-11-01T00:00:00Z');
  it('shows trades published or still live during the membership', () => {
    expect(
      visibleToMember(
        { status: 'CLOSED', publishedAt: '2026-10-01T00:00:00Z', closedAt: '2026-10-02T00:00:00Z' },
        from,
      ),
    ).toBe(false);
    expect(
      visibleToMember(
        { status: 'CLOSED', publishedAt: '2026-10-30T00:00:00Z', closedAt: '2026-11-02T00:00:00Z' },
        from,
      ),
    ).toBe(true);
    expect(
      visibleToMember(
        { status: 'CLOSED', publishedAt: '2026-11-03T00:00:00Z', closedAt: '2026-11-04T00:00:00Z' },
        from,
      ),
    ).toBe(true);
    expect(visibleToMember({ status: 'ACTIVE', publishedAt: '2026-01-01T00:00:00Z', closedAt: null }, from)).toBe(true);
    expect(visibleToMember({ status: 'CLOSED', publishedAt: '2020-01-01T00:00:00Z', closedAt: null }, null)).toBe(true);
  });

  it('starts at the earliest membership period', () => {
    expect(membershipStart([])).toBeNull();
    expect(membershipStart([undefined, new Date('2026-05-01'), new Date('2026-02-01')])?.toISOString()).toBe(
      '2026-02-01T00:00:00.000Z',
    );
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
