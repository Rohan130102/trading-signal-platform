import { DateTime } from 'luxon';

/**
 * Subscription policy: INCLUSIVE CALENDAR DAYS in the configured business timezone.
 *
 * A window of N days starting on local date D is valid through the end of local date D + N - 1.
 * `expiresAt` is stored as the exclusive UTC instant of the following local midnight, so a one-day
 * subscription starting today at 14:00 stays valid until 00:00 tomorrow, and access is simply
 * `startsAt <= now < expiresAt`. DST is handled by working in local calendar dates.
 */

export const SUBSCRIPTION_STATES = ['NONE', 'SCHEDULED', 'ACTIVE', 'EXPIRED'] as const;
export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];

export interface SubscriptionWindow {
  startsAt: Date;
  expiresAt: Date;
}

export const MAX_SUBSCRIPTION_DAYS = 3660;

export function isValidTimezone(tz: string): boolean {
  return DateTime.now().setZone(tz).isValid;
}

function assertDays(durationDays: number): void {
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > MAX_SUBSCRIPTION_DAYS) {
    throw new RangeError(`Duration must be 1 to ${MAX_SUBSCRIPTION_DAYS} days.`);
  }
}

function localDayStart(instant: Date, tz: string): DateTime {
  return DateTime.fromJSDate(instant, { zone: tz }).startOf('day');
}

/** Parses YYYY-MM-DD as the start of that calendar date in the business timezone. */
export function localDateToInstant(date: string, tz: string): Date {
  const dt = DateTime.fromISO(date, { zone: tz }).startOf('day');
  if (!dt.isValid) throw new RangeError(`Invalid date: ${date}`);
  return dt.toJSDate();
}

/** The exclusive end of an inclusive local date: the next local midnight. */
export function endOfLocalDateExclusive(date: string, tz: string): Date {
  const dt = DateTime.fromISO(date, { zone: tz }).startOf('day');
  if (!dt.isValid) throw new RangeError(`Invalid date: ${date}`);
  return dt.plus({ days: 1 }).toJSDate();
}

export function computeInitialWindow(startsAt: Date, durationDays: number, tz: string): SubscriptionWindow {
  assertDays(durationDays);
  return {
    startsAt,
    expiresAt: localDayStart(startsAt, tz).plus({ days: durationDays }).toJSDate(),
  };
}

export interface RenewalResult extends SubscriptionWindow {
  /** Which branch of the renewal policy applied, recorded on the subscription event. */
  mode: 'EXTENDED_FROM_EXPIRY' | 'RESTARTED_FROM_NOW';
}

/**
 * Renewal policy: time still owed is never lost. A subscription still running (or scheduled) is
 * extended from its current expiry; one already expired starts a fresh window today.
 */
export function computeRenewal(
  current: SubscriptionWindow,
  durationDays: number,
  now: Date,
  tz: string,
): RenewalResult {
  assertDays(durationDays);
  if (now.getTime() < current.expiresAt.getTime()) {
    return {
      startsAt: current.startsAt,
      expiresAt: DateTime.fromJSDate(current.expiresAt, { zone: tz })
        .startOf('day')
        .plus({ days: durationDays })
        .toJSDate(),
      mode: 'EXTENDED_FROM_EXPIRY',
    };
  }
  return { ...computeInitialWindow(now, durationDays, tz), mode: 'RESTARTED_FROM_NOW' };
}

export function subscriptionState(sub: SubscriptionWindow | null, now: Date): SubscriptionState {
  if (!sub) return 'NONE';
  if (now.getTime() < sub.startsAt.getTime()) return 'SCHEDULED';
  return now.getTime() < sub.expiresAt.getTime() ? 'ACTIVE' : 'EXPIRED';
}

/** Last calendar date of access, for display. The inverse of the exclusive-instant convention. */
export function lastValidLocalDate(expiresAt: Date, tz: string): string {
  return DateTime.fromMillis(expiresAt.getTime() - 1, { zone: tz }).toISODate() as string;
}

/** Whole calendar days of access remaining, counting today. Zero once expired. */
export function daysRemaining(sub: SubscriptionWindow, now: Date, tz: string): number {
  if (now.getTime() >= sub.expiresAt.getTime()) return 0;
  const lastDay = DateTime.fromMillis(sub.expiresAt.getTime() - 1, { zone: tz }).startOf('day');
  const today = DateTime.fromJSDate(now, { zone: tz }).startOf('day');
  return Math.max(0, Math.round(lastDay.diff(today, 'days').days) + 1);
}

export const USER_STATUSES = ['ACTIVE', 'SUSPENDED', 'DISABLED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
export const ROLES = ['ADMIN', 'SUBSCRIBER'] as const;
export type Role = (typeof ROLES)[number];

export type AccessDenial = 'ACCOUNT_DISABLED' | 'SUBSCRIPTION_NONE' | 'SUBSCRIPTION_SCHEDULED' | 'SUBSCRIPTION_EXPIRED';

export interface AccessDecision {
  allowed: boolean;
  reason: AccessDenial | null;
  /** Instant at which this decision stops being valid, when known. */
  validUntil: Date | null;
}

/**
 * The single rule for "may this person see private signals right now". Used by REST guards, the
 * WebSocket gateway and the push dispatcher, so the three can never disagree.
 */
export function evaluateSignalAccess(
  user: { role: Role; status: UserStatus },
  subscription: SubscriptionWindow | null,
  now: Date,
): AccessDecision {
  if (user.status !== 'ACTIVE') return { allowed: false, reason: 'ACCOUNT_DISABLED', validUntil: null };
  if (user.role === 'ADMIN') return { allowed: true, reason: null, validUntil: null };
  switch (subscriptionState(subscription, now)) {
    case 'NONE':
      return { allowed: false, reason: 'SUBSCRIPTION_NONE', validUntil: null };
    case 'SCHEDULED':
      return { allowed: false, reason: 'SUBSCRIPTION_SCHEDULED', validUntil: null };
    case 'EXPIRED':
      return { allowed: false, reason: 'SUBSCRIPTION_EXPIRED', validUntil: null };
    case 'ACTIVE':
      return { allowed: true, reason: null, validUntil: (subscription as SubscriptionWindow).expiresAt };
  }
}
