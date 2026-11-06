import { formatPoints, toDec } from '@signaldesk/domain';

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
const fullDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'medium' });

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return (date.getFullYear() === new Date().getFullYear() ? dateTime : dateTimeYear).format(date);
}

const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export function formatClock(iso: string): string {
  return clock.format(new Date(iso));
}

export function formatFull(iso: string): string {
  return fullDate.format(new Date(iso));
}

export function formatRelative(iso: string, now = Date.now()): string {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  if (seconds < 7 * 86_400) return `${Math.round(seconds / 86_400)}d ago`;
  return formatDateTime(iso);
}

/** A calendar date with no time attached, e.g. the last day of a subscription. */
export function formatLocalDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year as number, (month as number) - 1, day)),
  );
}

export function signedPoints(points: string): string {
  const value = toDec(points);
  return `${value.greaterThan(0) ? '+' : ''}${formatPoints(value)} pts`;
}

export function money(value: string, currency: string): string {
  const d = toDec(value);
  const fixed = d.abs().toFixed(2);
  const grouped = fixed.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${d.isNegative() && !d.isZero() ? '−' : ''}${grouped} ${currency}`;
}

export function percent(fraction: string, decimals = 1): string {
  return `${toDec(fraction).times(100).toDecimalPlaces(decimals).toFixed()}%`;
}

export function newKey(): string {
  return crypto.randomUUID();
}
