import { describe, expect, it } from 'vitest';
import {
  computeInitialWindow,
  computeRenewal,
  lastValidLocalDate,
  type MeResponse,
  previewStart,
  subscriberActions,
  subscriberStatus,
  trialGreetingCopy,
  trialToGreet,
} from '../src/index.js';

const IST = 'Asia/Kolkata';
const at = (iso: string) => new Date(iso);
const NOW = at('2026-11-14T08:30:00Z'); // 14:00 IST

describe('custom durations', () => {
  it('accepts any whole number of days, such as 37, and refuses the rest', () => {
    const w = computeInitialWindow(NOW, 37, IST);
    expect(lastValidLocalDate(w.expiresAt, IST)).toBe('2026-12-20');
    for (const bad of [0, -1, 2.5, 3661]) expect(() => computeInitialWindow(NOW, bad, IST)).toThrow(RangeError);
  });

  it('restarts an expired subscription from the chosen activation date', () => {
    const current = { startsAt: at('2026-10-01T00:00:00Z'), expiresAt: at('2026-11-01T18:30:00Z') };
    const from = at('2026-11-20T18:30:00Z'); // 21 Nov, 00:00 IST
    const r = computeRenewal(current, 30, NOW, IST, from);
    expect(r.mode).toBe('RESTARTED_FROM_DATE');
    expect(r.startsAt).toEqual(from);
    expect(lastValidLocalDate(r.expiresAt, IST)).toBe('2026-12-20');
    // A running one still extends from its expiry, whatever date is given: renewing never shortens access.
    const running = { startsAt: at('2026-11-01T00:00:00Z'), expiresAt: at('2026-11-30T18:30:00Z') };
    expect(computeRenewal(running, 5, NOW, IST, from).mode).toBe('EXTENDED_FROM_EXPIRY');
  });
});

describe('starting a subscription', () => {
  it('flags a start that would end before access already running', () => {
    const trial = { startsAt: NOW, expiresAt: at('2026-11-30T18:30:00Z') };
    expect(previewStart(trial, NOW, 3, NOW, IST).shortensAccess).toBe(true);
    expect(previewStart(trial, NOW, 30, NOW, IST).shortensAccess).toBe(false);
    expect(previewStart(null, NOW, 3, NOW, IST).shortensAccess).toBe(false);
    const expired = { startsAt: at('2026-10-01T00:00:00Z'), expiresAt: at('2026-11-01T18:30:00Z') };
    expect(previewStart(expired, NOW, 3, NOW, IST).shortensAccess).toBe(false);
  });

  it('offers only the actions that fit the current state', () => {
    const running = { startsAt: NOW, expiresAt: at('2026-11-30T18:30:00Z') };
    const ended = { startsAt: at('2026-10-01T00:00:00Z'), expiresAt: at('2026-11-01T18:30:00Z') };
    expect(subscriberActions(null, NOW)).toEqual(['START', 'GRANT_TRIAL']);
    expect(subscriberActions({ ...running, kind: 'TRIAL' }, NOW)).toEqual(['START']);
    expect(subscriberActions({ ...ended, kind: 'TRIAL' }, NOW)).toEqual(['START', 'GRANT_TRIAL']);
    expect(subscriberActions({ ...running, kind: 'PAID' }, NOW)).toEqual(['RENEW']);
    expect(subscriberActions({ ...ended, kind: 'PAID' }, NOW)).toEqual(['RENEW']);
  });
});

describe('trial greeting', () => {
  const grant = {
    id: 'g1',
    durationDays: 5,
    startsAt: NOW,
    expiresAt: at('2026-11-18T18:30:00Z'),
    acknowledgedAt: null,
  };
  const trial = { startsAt: grant.startsAt, expiresAt: grant.expiresAt, kind: 'TRIAL' as const };

  it('greets a new grant while it gives access', () => {
    expect(trialToGreet(grant, trial, NOW)).toBe(grant);
  });

  it('does not greet twice, after the trial ended, or once a paid subscription replaced it', () => {
    expect(trialToGreet({ ...grant, acknowledgedAt: NOW }, trial, NOW)).toBeNull();
    expect(trialToGreet(grant, trial, at('2026-11-19T00:00:00Z'))).toBeNull();
    expect(trialToGreet(grant, { ...trial, kind: 'PAID' }, NOW)).toBeNull();
    expect(trialToGreet(grant, { ...trial, expiresAt: at('2026-12-30T18:30:00Z') }, NOW)).toBeNull();
    expect(trialToGreet(null, trial, NOW)).toBeNull();
  });

  it('uses the granted number of days and the real last day', () => {
    const copy = trialGreetingCopy({ durationDays: 5, lastValidDate: '2026-11-18' });
    expect(copy.title).toBe("You've received a 5-Day Free Trial");
    expect(copy.body).toContain('November');
    expect(copy.body).toContain('18');
  });
});

describe('subscriber status screens', () => {
  const me = (overrides: Partial<MeResponse>): MeResponse =>
    ({
      id: 'u',
      name: 'Asha Rao',
      loginId: 'asha@example.com',
      role: 'SUBSCRIBER',
      next: null,
      mfaEnabled: false,
      subscription: {
        state: 'NONE',
        kind: null,
        startsAt: null,
        expiresAt: null,
        lastValidDate: null,
        daysRemaining: 0,
        timezone: IST,
      },
      access: { allowed: false, reason: 'SUBSCRIPTION_NONE' },
      support: {
        serviceName: 'Signal Desk',
        whatsapp: '+919987255414',
        email: 'help@example.com',
        contact: '',
        renewalInstructions: '',
      },
      enquiryStatus: 'NOT_CONTACTED',
      profile: null,
      trialGreeting: null,
      onboardedAt: null,
      isMasterAdmin: false,
      security: { screenshotsAllowed: false },
      ...overrides,
    }) as MeResponse;

  it('moves from enquiring to contacting support as the enquiry progresses', () => {
    expect(subscriberStatus(me({}))).toMatchObject({ key: 'NONE', primary: { label: 'Enquire About Subscription' } });
    expect(subscriberStatus(me({ enquiryStatus: 'INITIATED' }))).toMatchObject({
      key: 'ENQUIRY_STARTED',
      title: 'Enquiry Started',
      primary: { label: 'Contact Support' },
    });
    expect(subscriberStatus(me({ enquiryStatus: 'UNDER_DISCUSSION' }))).toMatchObject({
      key: 'UNDER_DISCUSSION',
      title: 'Subscription Under Discussion',
    });
  });

  it('tells an expired subscriber or trial how to renew', () => {
    const expired = {
      access: { allowed: false, reason: 'SUBSCRIPTION_EXPIRED' as const },
      subscription: {
        state: 'EXPIRED' as const,
        kind: 'PAID' as const,
        startsAt: '2026-10-01T00:00:00Z',
        expiresAt: '2026-11-01T18:30:00Z',
        lastValidDate: '2026-11-01',
        daysRemaining: 0,
        timezone: IST,
      },
    };
    expect(subscriberStatus(me(expired))).toMatchObject({
      key: 'EXPIRED',
      title: 'Your Subscription Has Expired',
      primary: { label: 'Enquire About Renewal', purpose: 'RENEWAL' },
      secondary: { label: 'Contact Support' },
    });
    expect(subscriberStatus(me({ ...expired, subscription: { ...expired.subscription, kind: 'TRIAL' } }))?.key).toBe(
      'TRIAL_ENDED',
    );
  });

  it('shows nothing to someone with access, or to an administrator', () => {
    expect(subscriberStatus(me({ access: { allowed: true, reason: null } }))).toBeNull();
    expect(subscriberStatus(me({ role: 'ADMIN' }))).toBeNull();
  });
});
