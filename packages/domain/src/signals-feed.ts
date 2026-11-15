import { z } from 'zod';
import type { FeedEvent, PublicOutcome, TradeSummary } from './dto.js';
import { DIRECTIONS, type Direction } from './signal.js';
import { LIVE_STATUSES, TERMINAL_STATUSES, type EventCategory, type EventType, type TradeStatus } from './status.js';

/**
 * The subscriber's Signals list groups every update under its trade, newest activity first. Filters
 * are applied by the server so paging stays correct, and only filters that mean something in the data
 * exist: instrument, direction and status.
 */

export const STATUS_GROUPS = ['ALL', 'OPEN', 'AWAITING', 'LIVE', 'CLOSED'] as const;
export type StatusGroup = (typeof STATUS_GROUPS)[number];

export const STATUS_GROUP_LABELS: Record<StatusGroup, string> = {
  ALL: 'All',
  OPEN: 'Open',
  AWAITING: 'Upcoming',
  LIVE: 'Active',
  CLOSED: 'Finished',
};

/** The trade statuses each group stands for. Drafts never appear to subscribers. */
export function statusesForGroup(group: StatusGroup): TradeStatus[] | null {
  switch (group) {
    case 'ALL':
      return null;
    case 'OPEN':
      return [...LIVE_STATUSES];
    case 'AWAITING':
      return ['PUBLISHED'];
    case 'LIVE':
      return ['ACTIVE', 'PARTIALLY_CLOSED'];
    case 'CLOSED':
      return [...TERMINAL_STATUSES];
  }
}

export interface SignalFilter {
  /** Empty means every instrument. */
  symbols: string[];
  direction: Direction | null;
  status: StatusGroup;
}

export const EMPTY_SIGNAL_FILTER: SignalFilter = { symbols: [], direction: null, status: 'ALL' };

/** How many filters are switched on, for the badge on the filter button. */
export function countActiveFilters(filter: SignalFilter): number {
  return (filter.symbols.length > 0 ? 1 : 0) + (filter.direction ? 1 : 0) + (filter.status !== 'ALL' ? 1 : 0);
}

const SYMBOL = /^[A-Z0-9/._-]{1,24}$/;

/** A filter saved on a phone may name instruments that no longer exist. Those are dropped, not errors. */
export function normaliseFilter(value: unknown, knownSymbols?: readonly string[]): SignalFilter {
  const input = (typeof value === 'object' && value !== null ? value : {}) as Partial<
    Record<keyof SignalFilter, unknown>
  >;
  const symbols = Array.isArray(input.symbols)
    ? [...new Set(input.symbols.filter((s): s is string => typeof s === 'string' && SYMBOL.test(s)))]
    : [];
  return {
    symbols: knownSymbols ? symbols.filter((s) => knownSymbols.includes(s)) : symbols,
    direction: DIRECTIONS.includes(input.direction as Direction) ? (input.direction as Direction) : null,
    status: STATUS_GROUPS.includes(input.status as StatusGroup) ? (input.status as StatusGroup) : 'ALL',
  };
}

/** Query-string form, shared by the app and the API so the two can never disagree. */
export function filterToQuery(filter: SignalFilter): Record<string, string | undefined> {
  return {
    symbols: filter.symbols.length > 0 ? filter.symbols.join(',') : undefined,
    direction: filter.direction ?? undefined,
    status: filter.status === 'ALL' ? undefined : filter.status,
  };
}

export const symbolList = z
  .string()
  .max(24 * 40)
  .optional()
  .transform((value) => (value ? [...new Set(value.split(',').map((s) => s.trim()))].filter(Boolean) : []))
  .pipe(z.array(z.string().regex(SYMBOL, 'Unknown instrument')).max(40));

export const signalsQuerySchema = z.object({
  symbols: symbolList,
  direction: z.enum(DIRECTIONS).optional(),
  status: z.enum(STATUS_GROUPS).default('ALL'),
  /** Keyset cursor: the activity position of the last card on the previous page. */
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export interface SignalCard extends TradeSummary {
  /** Newest first. The first is the latest update; at most three earlier ones follow. */
  recentUpdates: FeedEvent[];
  /** Something on this trade arrived after the subscriber last caught up. */
  unread: boolean;
  /** Position in the stream of activity, used as the paging cursor. */
  activitySeq: number;
  outcome: PublicOutcome | null;
}

export interface SignalsPage {
  cards: SignalCard[];
  nextBefore: number | null;
  headSeq: number;
  unread: number;
}

export interface HistoryRow extends TradeSummary {
  outcome: PublicOutcome | null;
  /** Hidden from this subscriber's Signals list by their own choice. */
  hidden: boolean;
  /** Moved out of the Signals list by an administrator. Still part of the record. */
  archived: boolean;
}

export interface HistoryResponse {
  trades: HistoryRow[];
  total: number;
  page: number;
  pageSize: number;
}

/* ---------- Hiding from one's own feed ---------- */

export const HIDDEN_ITEM_TYPES = ['TRADE', 'ANNOUNCEMENT'] as const;
export type HiddenItemType = (typeof HIDDEN_ITEM_TYPES)[number];

export const hideItemSchema = z.strictObject({
  type: z.enum(HIDDEN_ITEM_TYPES),
  id: z.uuid(),
});

/* ---------- Notification centre ---------- */

export interface NotificationItem {
  seq: number;
  eventId: string;
  type: EventType;
  category: EventCategory;
  title: string;
  body: string;
  tradeId: string | null;
  symbol: string | null;
  direction: Direction | null;
  priority: 'NORMAL' | 'PRIORITY';
  createdAt: string;
  unread: boolean;
  /** Where tapping it leads in the app. */
  path: string;
}

export interface NotificationsPage {
  items: NotificationItem[];
  unread: number;
  nextBefore: number | null;
}

export const notificationsQuerySchema = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});

export const markNotificationsReadSchema = z.union([
  z.strictObject({ all: z.literal(true), upToSeq: z.number().int().min(0) }),
  z.strictObject({ eventIds: z.array(z.uuid()).min(1).max(100) }),
  z.strictObject({ tradeId: z.uuid() }),
]);

/* ---------- Administrative archive of finished trades ---------- */

/** Only finished trades leave the Signals list. A live trade must stay where subscribers will see it. */
export function canArchiveTrade(status: TradeStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export const archiveTradesSchema = z.strictObject({
  tradeIds: z.array(z.uuid()).min(1).max(500),
  expectedCount: z.number().int().min(1).max(500),
  reason: z.string().trim().max(300).optional(),
});

export const archiveBeforeSchema = z.strictObject({
  /** Finished trades that closed before this local date. */
  before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD'),
  expectedCount: z.number().int().min(1).max(100_000),
  reason: z.string().trim().max(300).optional(),
});

export const unarchiveTradesSchema = z.strictObject({
  tradeIds: z.array(z.uuid()).min(1).max(500),
});

/* ---------- Small subscriber settings ---------- */

export const securityEventSchema = z.strictObject({
  type: z.enum(['SCREENSHOT', 'SCREEN_RECORDING']),
  screen: z.string().trim().max(60).optional(),
});

export const pushOpenedSchema = z.strictObject({ eventId: z.uuid() });
