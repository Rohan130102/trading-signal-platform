import { z } from 'zod';
import { LIVE_STATUSES, type TradeStatus } from './status.js';

/**
 * Platform rules the Master Admin sets in the app instead of in the code, and the small pure decisions that
 * depend on them. The API applies them; the apps use the same functions to show what will happen.
 */

/** AWAITING_ENTRY: a new signal waits until it is activated or its entry window ends. ACTIVE: active at once. */
export const SIGNAL_START_MODES = ['AWAITING_ENTRY', 'ACTIVE'] as const;
export type SignalStartMode = (typeof SIGNAL_START_MODES)[number];

/** GENERAL: "trail the stop-loss to X". DETAILED: also states the distance in points and its reference price. */
export const TRAILING_STOP_WORDINGS = ['GENERAL', 'DETAILED'] as const;
export type TrailingStopWording = (typeof TRAILING_STOP_WORDINGS)[number];

/** MEMBERSHIP: a subscriber's lists start when their membership did. ALL: every published trade. */
export const HISTORY_SCOPES = ['MEMBERSHIP', 'ALL'] as const;
export type HistoryScope = (typeof HISTORY_SCOPES)[number];

/** The longest entry window: 30 days, in minutes. */
export const MAX_ENTRY_WINDOW_MINUTES = 30 * 24 * 60;
/** Shorter windows would expire before most subscribers could read the alert. */
export const MIN_ENTRY_WINDOW_MINUTES = 5;
/** Choices offered in the composers. The platform default is always offered as well. */
export const ENTRY_WINDOW_CHOICES = [15, 30, 60, 120, 240, 1440] as const;

export const SIGNAL_START_MODE_LABELS: Record<SignalStartMode, string> = {
  AWAITING_ENTRY: 'Awaiting entry',
  ACTIVE: 'Active immediately',
};

/** "15 min", "1 h", "1 h 30 min", "1 day". Zero reads as "No limit". */
export function entryWindowLabel(minutes: number): string {
  if (minutes <= 0) return 'No limit';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(days === 1 ? '1 day' : `${days} days`);
  if (hours > 0) parts.push(`${hours} h`);
  if (mins > 0) parts.push(`${mins} min`);
  return parts.join(' ');
}

/** Whether a new signal starts active. An explicit choice in the composer wins over the platform default. */
export function startsActive(requested: boolean | undefined, mode: SignalStartMode): boolean {
  return requested ?? mode === 'ACTIVE';
}

/**
 * When an unfilled signal stops waiting. An explicit instant wins, explicit null means no limit, and otherwise
 * the platform default applies (0 = no limit). A signal that starts active never waits, so it has none.
 */
export function resolveEntryExpiry(
  requested: string | null | undefined,
  defaultMinutes: number,
  active: boolean,
  now: Date,
): Date | null {
  if (active) return null;
  if (requested === null) return null;
  if (requested !== undefined) return new Date(requested);
  return defaultMinutes > 0 ? new Date(now.getTime() + defaultMinutes * 60_000) : null;
}

/** A subscriber's own setting wins; otherwise the platform default applies. */
export function screenshotsAllowedFor(override: boolean | null | undefined, platformDefault: boolean): boolean {
  return override ?? platformDefault;
}

/**
 * Whether a trade belongs in one subscriber's lists: it was published during their membership, or it was
 * still live at some point during it. Live trades are always shown, because a member should see every
 * instruction that is still in force. `from` null means no restriction.
 */
export function visibleToMember(
  trade: { status: TradeStatus; publishedAt: Date | string | null; closedAt: Date | string | null },
  from: Date | null,
): boolean {
  if (!from) return true;
  if (LIVE_STATUSES.includes(trade.status)) return true;
  const at = (value: Date | string | null) => (value === null ? null : new Date(value).getTime());
  const published = at(trade.publishedAt);
  const closed = at(trade.closedAt);
  return (published !== null && published >= from.getTime()) || (closed !== null && closed >= from.getTime());
}

/** The earliest start of any of a subscriber's membership periods. Null when they never had one. */
export function membershipStart(starts: (Date | null | undefined)[]): Date | null {
  const times = starts.filter((d): d is Date => d instanceof Date).map((d) => d.getTime());
  return times.length === 0 ? null : new Date(Math.min(...times));
}

/* ---------- Requests ---------- */

const loginId = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[a-zA-Z0-9._@+-]+$/, 'Use letters, digits and . _ @ + -');

export const createAdminSchema = z.strictObject({
  name: z.string().trim().min(1, 'Enter a name').max(120),
  loginId,
  email: z.email().max(200).nullable().optional(),
  idempotencyKey: z.uuid(),
});

export const ADMIN_STATUSES = ['ACTIVE', 'SUSPENDED', 'DISABLED'] as const;
export const adminStatusSchema = z.strictObject({
  status: z.enum(ADMIN_STATUSES),
  note: z.string().trim().max(500).optional(),
});

export const masterAdminSchema = z.strictObject({
  isMasterAdmin: z.boolean(),
  note: z.string().trim().max(500).optional(),
});

/** Typed by the Master Admin, so a removal is never one stray tap. */
export const REMOVE_CONFIRMATION = 'REMOVE';
export const removeTradesSchema = z.strictObject({
  tradeIds: z.array(z.uuid()).min(1).max(200),
  /** What the Master Admin saw and confirmed. The request fails if the selection changed meanwhile. */
  expectedCount: z.number().int().min(1).max(200),
  reason: z.string().trim().min(5, 'Say why, in at least 5 characters').max(500),
  confirm: z.literal(REMOVE_CONFIRMATION, { error: `Type ${REMOVE_CONFIRMATION} to confirm` }),
});
export const restoreRemovedTradesSchema = z.strictObject({
  tradeIds: z.array(z.uuid()).min(1).max(200),
});

export const screenshotPermissionSchema = z.strictObject({
  /** Null follows the platform default. */
  screenshotsAllowed: z.boolean().nullable(),
});

export const clearHistorySchema = z.strictObject({
  /** Only finished trades are cleared. Live trades always stay on screen. */
  confirm: z.literal(true),
});

/* ---------- Responses ---------- */

export interface AdminAccount {
  id: string;
  name: string;
  loginId: string;
  email: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
  isMasterAdmin: boolean;
  mfaEnabled: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  createdBy: string | null;
  isYou: boolean;
}

export interface PlatformSettings {
  signalStartMode: SignalStartMode;
  entryExpiryMinutesDefault: number;
  trailingStopWording: TrailingStopWording;
  screenshotsAllowedDefault: boolean;
  historyScope: HistoryScope;
}
