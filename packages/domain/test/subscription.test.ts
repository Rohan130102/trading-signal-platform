import { describe, expect, it } from 'vitest';
import {
  computeInitialWindow,
  computeRenewal,
  daysRemaining,
  DEFAULT_TEMPLATES,
  endOfLocalDateExclusive,
  evaluateSignalAccess,
  isValidTimezone,
  lastValidLocalDate,
  localDateToInstant,
  renderTemplateText,
  subscriptionState,
  TEMPLATE_KINDS,
  validateTemplateText,
} from '../src/index.js';

const IST = 'Asia/Kolkata';
const at = (iso: string) => new Date(iso);

describe('inclusive calendar-day windows', () => {
  it('a one-day subscription started today is valid through the end of today', () => {
    const start = at('2026-11-05T08:30:00Z'); // 14:00 IST
    const w = computeInitialWindow(start, 1, IST);
    expect(w.expiresAt.toISOString()).toBe('2026-11-05T18:30:00.000Z'); // next IST midnight
    expect(lastValidLocalDate(w.expiresAt, IST)).toBe('2026-11-05');
  });

  it('counts N calendar days including the first', () => {
    const w = computeInitialWindow(at('2026-11-05T08:30:00Z'), 30, IST);
    expect(lastValidLocalDate(w.expiresAt, IST)).toBe('2026-12-04');
  });

  it('uses the business timezone to decide what "today" is', () => {
    const instant = at('2026-11-05T20:00:00Z'); // already Nov 6 in IST
    expect(lastValidLocalDate(computeInitialWindow(instant, 1, IST).expiresAt, IST)).toBe('2026-11-06');
    expect(lastValidLocalDate(computeInitialWindow(instant, 1, 'UTC').expiresAt, 'UTC')).toBe('2026-11-05');
  });

  it('is correct across daylight-saving changes', () => {
    const ny = 'America/New_York';
    const w = computeInitialWindow(at('2026-03-07T17:00:00Z'), 2, ny); // spans the Mar 8 clock change
    expect(lastValidLocalDate(w.expiresAt, ny)).toBe('2026-03-08');
    expect(w.expiresAt.toISOString()).toBe('2026-03-09T04:00:00.000Z');
    const back = computeInitialWindow(at('2026-10-31T17:00:00Z'), 2, ny); // spans the Nov 1 change
    expect(back.expiresAt.toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });

  it('rejects durations outside the allowed range', () => {
    expect(() => computeInitialWindow(at('2026-11-05T00:00:00Z'), 0, IST)).toThrow(RangeError);
    expect(() => computeInitialWindow(at('2026-11-05T00:00:00Z'), 1.5, IST)).toThrow(RangeError);
    expect(() => computeInitialWindow(at('2026-11-05T00:00:00Z'), 99999, IST)).toThrow(RangeError);
  });

  it('parses local dates and rejects bad ones', () => {
    expect(localDateToInstant('2026-11-05', IST).toISOString()).toBe('2026-11-04T18:30:00.000Z');
    expect(endOfLocalDateExclusive('2026-11-05', IST).toISOString()).toBe('2026-11-05T18:30:00.000Z');
    expect(() => localDateToInstant('2026-13-45', IST)).toThrow(RangeError);
    expect(isValidTimezone(IST)).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
  });
});

describe('state boundaries', () => {
  const w = { startsAt: at('2026-11-05T00:00:00Z'), expiresAt: at('2026-11-06T00:00:00Z') };

  it('expiry is exclusive', () => {
    expect(subscriptionState(w, at('2026-11-05T23:59:59.999Z'))).toBe('ACTIVE');
    expect(subscriptionState(w, at('2026-11-06T00:00:00.000Z'))).toBe('EXPIRED');
  });

  it('start is inclusive and earlier is scheduled', () => {
    expect(subscriptionState(w, at('2026-11-05T00:00:00.000Z'))).toBe('ACTIVE');
    expect(subscriptionState(w, at('2026-11-04T23:59:59.999Z'))).toBe('SCHEDULED');
    expect(subscriptionState(null, at('2026-11-04T00:00:00Z'))).toBe('NONE');
  });

  it('counts days remaining including today', () => {
    const start = at('2026-11-05T08:30:00Z');
    const window = computeInitialWindow(start, 3, IST);
    expect(daysRemaining(window, start, IST)).toBe(3);
    expect(daysRemaining(window, window.expiresAt, IST)).toBe(0);
    expect(daysRemaining(window, new Date(window.expiresAt.getTime() - 1), IST)).toBe(1);
  });
});

describe('renewal policy', () => {
  it('extends from the current expiry when still active, losing no paid time', () => {
    const current = computeInitialWindow(at('2026-11-05T08:30:00Z'), 10, IST);
    const r = computeRenewal(current, 30, at('2026-11-10T08:30:00Z'), IST);
    expect(r.mode).toBe('EXTENDED_FROM_EXPIRY');
    expect(r.startsAt).toEqual(current.startsAt);
    expect(lastValidLocalDate(r.expiresAt, IST)).toBe('2026-12-14');
  });

  it('starts over from renewal time when already expired', () => {
    const current = computeInitialWindow(at('2026-11-05T08:30:00Z'), 1, IST);
    const now = at('2026-11-20T08:30:00Z');
    const r = computeRenewal(current, 7, now, IST);
    expect(r.mode).toBe('RESTARTED_FROM_NOW');
    expect(r.startsAt).toEqual(now);
    expect(lastValidLocalDate(r.expiresAt, IST)).toBe('2026-11-26');
  });

  it('at the exact expiry instant it counts as expired', () => {
    const current = computeInitialWindow(at('2026-11-05T08:30:00Z'), 1, IST);
    expect(computeRenewal(current, 1, current.expiresAt, IST).mode).toBe('RESTARTED_FROM_NOW');
    expect(computeRenewal(current, 1, new Date(current.expiresAt.getTime() - 1), IST).mode).toBe(
      'EXTENDED_FROM_EXPIRY',
    );
  });
});

describe('access decision', () => {
  const sub = { startsAt: at('2026-11-05T00:00:00Z'), expiresAt: at('2026-11-06T00:00:00Z') };
  const active = at('2026-11-05T12:00:00Z');
  const subscriber = { role: 'SUBSCRIBER' as const, status: 'ACTIVE' as const };

  it('allows an active subscriber and reports when that ends', () => {
    expect(evaluateSignalAccess(subscriber, sub, active)).toEqual({
      allowed: true,
      reason: null,
      validUntil: sub.expiresAt,
    });
  });

  it('denies expired, scheduled and missing subscriptions', () => {
    expect(evaluateSignalAccess(subscriber, sub, at('2026-11-06T00:00:00Z')).reason).toBe('SUBSCRIPTION_EXPIRED');
    expect(evaluateSignalAccess(subscriber, sub, at('2026-11-04T00:00:00Z')).reason).toBe('SUBSCRIPTION_SCHEDULED');
    expect(evaluateSignalAccess(subscriber, null, active).reason).toBe('SUBSCRIPTION_NONE');
  });

  it('a suspended or disabled account loses access even with time remaining', () => {
    expect(evaluateSignalAccess({ ...subscriber, status: 'SUSPENDED' }, sub, active).reason).toBe('ACCOUNT_DISABLED');
    expect(evaluateSignalAccess({ ...subscriber, status: 'DISABLED' }, sub, active).reason).toBe('ACCOUNT_DISABLED');
  });

  it('admins need no subscription but a disabled admin is still denied', () => {
    expect(evaluateSignalAccess({ role: 'ADMIN', status: 'ACTIVE' }, null, active).allowed).toBe(true);
    expect(evaluateSignalAccess({ role: 'ADMIN', status: 'SUSPENDED' }, null, active).allowed).toBe(false);
  });
});

describe('templates', () => {
  it('defines every kind exactly once, using only known fields', () => {
    expect(DEFAULT_TEMPLATES.map((t) => t.kind).sort()).toEqual([...TEMPLATE_KINDS].sort());
    for (const t of DEFAULT_TEMPLATES) {
      expect(validateTemplateText(t.title, 'title')).toEqual([]);
      expect(validateTemplateText(t.body, 'body')).toEqual([]);
    }
  });

  it('rejects unknown and malformed placeholders', () => {
    expect(validateTemplateText('{{secret}}', 'body')[0]?.code).toBe('UNKNOWN_FIELD');
    expect(validateTemplateText('{{ref', 'body')[0]?.code).toBe('MALFORMED');
  });

  it('drops a line whose optional value is empty, leaving no dangling label', () => {
    const text = 'Entry: {{entry}}\nTarget 2: {{target2}}\nStop-loss: {{stop}}\n{{comment}}';
    expect(renderTemplateText(text, { entry: '3,300.00', stop: '3,120.00' })).toBe(
      'Entry: 3,300.00\nStop-loss: 3,120.00',
    );
  });

  it('never interprets substituted values as template syntax', () => {
    expect(renderTemplateText('{{comment}}', { comment: '{{entry}} <b>x</b>' })).toBe('{{entry}} <b>x</b>');
  });
});
