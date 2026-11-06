import { formatPoints } from './instrument.js';
import { toDec } from './decimal.js';
import type { MeResponse } from './dto.js';
import type { CalculationBasis } from './pnl.js';
import type { EventCategory, EventType } from './status.js';

/** Presentation shared by every client, so a figure reads the same on web and on a phone. */

export function signedPoints(points: string): string {
  const value = toDec(points);
  return `${value.greaterThan(0) ? '+' : ''}${formatPoints(value)} pts`;
}

export function money(value: string, currency: string): string {
  const d = toDec(value);
  const grouped = d
    .abs()
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${d.isNegative() && !d.isZero() ? '−' : ''}${grouped} ${currency}`;
}

export function percent(fraction: string, decimals = 1): string {
  return `${toDec(fraction).times(100).toDecimalPlaces(decimals).toFixed()}%`;
}

/** A figure is never shown without saying what it rests on. */
export function basisShort(basis: CalculationBasis | undefined): string {
  return basis === 'ADMIN_DECLARED_EXECUTION' ? 'declared by the administrator, unverified' : 'hypothetical';
}

export function relativeTime(iso: string, now = Date.now()): string | null {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  if (seconds < 7 * 86_400) return `${Math.round(seconds / 86_400)}d ago`;
  return null;
}

const dateTime = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});
const dateTimeYear = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const fullDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'medium' });

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return (date.getFullYear() === new Date().getFullYear() ? dateTime : dateTimeYear).format(date);
}

export function formatClock(iso: string): string {
  return clock.format(new Date(iso));
}

export function formatFull(iso: string): string {
  return fullDate.format(new Date(iso));
}

export function formatRelative(iso: string, now = Date.now()): string {
  return relativeTime(iso, now) ?? formatDateTime(iso);
}

/** A calendar date with no time attached, e.g. the last day of a subscription. */
export function formatLocalDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year as number, (month as number) - 1, day)),
  );
}

/** A heading that says at once whether something is new or changes an existing trade. */
export function categoryLabel(category: EventCategory, ref?: string): string {
  switch (category) {
    case 'NEW_SIGNAL':
      return 'New signal';
    case 'UPDATE':
      return `Update to ${ref ?? 'trade'}`;
    case 'CLOSURE':
      return `Closed: ${ref ?? 'trade'}`;
    case 'ANNOUNCEMENT':
      return 'Announcement';
  }
}

/** Like categoryLabel, but a cancelled or expired signal is not described as closed. */
export function eventHeading(type: EventType, category: EventCategory, ref?: string): string {
  if (type === 'TRADE_CANCELLED') return `Cancelled: ${ref ?? 'signal'}`;
  if (type === 'ENTRY_EXPIRED') return `Expired: ${ref ?? 'signal'}`;
  return categoryLabel(category, ref);
}

/** What someone whose access has ended is told, on every client. */
export function accessEndedCopy(me: MeResponse): { title: string; body: string } {
  switch (me.access.reason) {
    case 'SUBSCRIPTION_EXPIRED':
      return {
        title: 'Your subscription has ended',
        body: `Your access ran through ${me.subscription.lastValidDate ? formatLocalDate(me.subscription.lastValidDate) : 'its last day'}. Signals and history are hidden until it is renewed.`,
      };
    case 'SUBSCRIPTION_SCHEDULED':
      return {
        title: 'Your subscription has not started yet',
        body: `It starts on ${me.subscription.startsAt ? new Date(me.subscription.startsAt).toLocaleDateString(undefined, { dateStyle: 'long' }) : 'its start date'}. Signals will appear here from then.`,
      };
    case 'ACCOUNT_DISABLED':
      return { title: 'This account is not active', body: 'Access to this account has been paused.' };
    default:
      return { title: 'No subscription yet', body: 'Your account is ready, but no subscription is attached to it.' };
  }
}
