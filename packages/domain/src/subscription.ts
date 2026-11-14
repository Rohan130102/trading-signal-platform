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

export function assertDays(durationDays: number): void {
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
  mode: 'EXTENDED_FROM_EXPIRY' | 'RESTARTED_FROM_NOW' | 'RESTARTED_FROM_DATE';
}

/**
 * Renewal policy: time still owed is never lost. A subscription still running (or scheduled) is
 * extended from its current expiry; one already expired starts a fresh window, today or from the
 * chosen activation instant.
 */
export function computeRenewal(
  current: SubscriptionWindow,
  durationDays: number,
  now: Date,
  tz: string,
  restartFrom?: Date,
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
  if (restartFrom && restartFrom.getTime() > now.getTime()) {
    return { ...computeInitialWindow(restartFrom, durationDays, tz), mode: 'RESTARTED_FROM_DATE' };
  }
  return { ...computeInitialWindow(now, durationDays, tz), mode: 'RESTARTED_FROM_NOW' };
}

/* ---------- Kinds of access, trials and starting a subscription ---------- */

/** What the current access window is. A trial gives the same access as a paid subscription. */
export const SUBSCRIPTION_KINDS = ['PAID', 'TRIAL'] as const;
export type SubscriptionKind = (typeof SUBSCRIPTION_KINDS)[number];

/** Shortcuts offered in the forms. Any whole number of days in range is accepted. */
export const SUBSCRIPTION_DAY_SHORTCUTS = [7, 30, 90, 180, 365] as const;
export const TRIAL_DAY_SHORTCUTS = [2, 3, 5, 7, 14] as const;
export const MAX_TRIAL_DAYS = 90;

export interface StartPreview extends SubscriptionWindow {
  /** True when the new window ends before the access the person already has. Needs explicit confirmation. */
  shortensAccess: boolean;
}

/**
 * Starting a subscription (or a trial) replaces whatever window exists from the chosen instant. Used for someone
 * with no access, an expired one, or a running trial. A running paid subscription is renewed instead.
 */
export function previewStart(
  current: SubscriptionWindow | null,
  startsAt: Date,
  durationDays: number,
  now: Date,
  tz: string,
): StartPreview {
  const window = computeInitialWindow(startsAt, durationDays, tz);
  const running = current !== null && current.expiresAt.getTime() > now.getTime();
  return {
    ...window,
    shortensAccess: running && window.expiresAt.getTime() < (current as SubscriptionWindow).expiresAt.getTime(),
  };
}

export type SubscriberAction = 'START' | 'RENEW' | 'GRANT_TRIAL';

/**
 * Which subscription actions make sense for this person now. A paid subscription is renewed, not started again;
 * a trial is offered only while no paid access is running, and a second trial needs an explicit override.
 */
export function subscriberActions(
  current: (SubscriptionWindow & { kind: SubscriptionKind }) | null,
  now: Date,
): SubscriberAction[] {
  const state = subscriptionState(current, now);
  if (!current || state === 'NONE') return ['START', 'GRANT_TRIAL'];
  if (current.kind === 'TRIAL') return state === 'EXPIRED' ? ['START', 'GRANT_TRIAL'] : ['START'];
  return ['RENEW'];
}

export interface TrialGrantView {
  id: string;
  durationDays: number;
  startsAt: Date;
  expiresAt: Date;
  acknowledgedAt: Date | null;
}

/**
 * The welcome is shown once per grant, only while that grant is what gives access right now. A grant seen on
 * another device, replaced by a paid subscription, or already over is never celebrated.
 */
export function trialToGreet(
  grant: TrialGrantView | null,
  current: (SubscriptionWindow & { kind: SubscriptionKind }) | null,
  now: Date,
): TrialGrantView | null {
  if (!grant || grant.acknowledgedAt || !current || current.kind !== 'TRIAL') return null;
  if (subscriptionState(current, now) !== 'ACTIVE') return null;
  if (current.expiresAt.getTime() !== grant.expiresAt.getTime()) return null;
  return grant;
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

/** "20 December 2026": the last day of access in the business timezone, as people read it. */
export function accessUntilLabel(expiresAt: Date, tz: string): string {
  return DateTime.fromMillis(expiresAt.getTime() - 1, { zone: tz }).setLocale('en-GB').toFormat('d LLLL yyyy');
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
