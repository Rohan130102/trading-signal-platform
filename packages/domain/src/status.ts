/** Lifecycle vocabulary and the transition table. No behaviour other than lookups lives here. */

export const TRADE_STATUSES = [
  'DRAFT',
  'PUBLISHED',
  'ACTIVE',
  'PARTIALLY_CLOSED',
  'CLOSED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type TradeStatus = (typeof TRADE_STATUSES)[number];

export const TERMINAL_STATUSES: readonly TradeStatus[] = ['CLOSED', 'CANCELLED', 'EXPIRED'];
/** A trade a subscriber should be watching right now. */
export const LIVE_STATUSES: readonly TradeStatus[] = ['PUBLISHED', 'ACTIVE', 'PARTIALLY_CLOSED'];

/**
 * PUBLISHED only ever becomes ACTIVE through an ACTIVATE action. By default publishing applies that action in
 * the same transaction (see `activateOnPublish`), so a new signal is active at once; the activation is still
 * recorded as its own event, and is never a fill. There is deliberately no edge that skips a state, and
 * terminal states have no way out.
 */
export const TRANSITIONS: Record<TradeStatus, readonly TradeStatus[]> = {
  DRAFT: ['PUBLISHED'],
  PUBLISHED: ['ACTIVE', 'CANCELLED', 'EXPIRED'],
  ACTIVE: ['PARTIALLY_CLOSED', 'CLOSED'],
  PARTIALLY_CLOSED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export const TRADE_ACTIONS = [
  'ACTIVATE',
  'RECORD_EXECUTION',
  'MOVE_STOP',
  'MOVE_STOP_BREAKEVEN',
  'TRAIL_STOP',
  'TARGET_HIT',
  'MODIFY_TARGETS',
  'BOOK_PARTIAL',
  'CLOSE',
  'URGENT',
  'CANCEL',
  'EXPIRE',
  'CORRECT',
] as const;
export type TradeAction = (typeof TRADE_ACTIONS)[number];

const LIVE: TradeStatus[] = ['PUBLISHED', 'ACTIVE', 'PARTIALLY_CLOSED'];
const IN_POSITION: TradeStatus[] = ['ACTIVE', 'PARTIALLY_CLOSED'];

export const ACTION_FROM: Record<TradeAction, readonly TradeStatus[]> = {
  ACTIVATE: ['PUBLISHED'],
  RECORD_EXECUTION: IN_POSITION,
  MOVE_STOP: LIVE,
  MOVE_STOP_BREAKEVEN: IN_POSITION,
  TRAIL_STOP: IN_POSITION,
  TARGET_HIT: IN_POSITION,
  MODIFY_TARGETS: LIVE,
  BOOK_PARTIAL: IN_POSITION,
  CLOSE: IN_POSITION,
  URGENT: LIVE,
  CANCEL: ['PUBLISHED'],
  EXPIRE: ['PUBLISHED'],
  /** Every published stage: a mistake can be put right at any time, and the correction stays in the history. */
  CORRECT: ['PUBLISHED', 'ACTIVE', 'PARTIALLY_CLOSED', 'CLOSED', 'CANCELLED', 'EXPIRED'],
};

export function canTransition(from: TradeStatus, to: TradeStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Actions that need a stop-loss or targets, which an upcoming trade gets only when it is activated. */
const NEEDS_LEVELS: readonly TradeAction[] = [
  'MOVE_STOP',
  'MOVE_STOP_BREAKEVEN',
  'TRAIL_STOP',
  'TARGET_HIT',
  'MODIFY_TARGETS',
];

export function allowedActions(status: TradeStatus, levelsPending = false): TradeAction[] {
  return TRADE_ACTIONS.filter(
    (action) => ACTION_FROM[action].includes(status) && !(levelsPending && NEEDS_LEVELS.includes(action)),
  );
}

export const STATUS_LABELS: Record<TradeStatus, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Awaiting entry',
  ACTIVE: 'Active',
  PARTIALLY_CLOSED: 'Partly closed',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired, no entry',
};

export const EVENT_TYPES = [
  'SIGNAL_PUBLISHED',
  'ENTRY_ACTIVATED',
  'EXECUTION_RECORDED',
  'STOP_MOVED',
  'TARGET_HIT',
  'TARGETS_MODIFIED',
  'PARTIAL_BOOKED',
  'TRADE_CLOSED',
  'TRADE_CANCELLED',
  'ENTRY_EXPIRED',
  'URGENT_INSTRUCTION',
  'CORRECTION',
  'ANNOUNCEMENT',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** What a subscriber is being told, independent of the wording. Drives the visual treatment. */
export type EventCategory = 'NEW_SIGNAL' | 'UPDATE' | 'CLOSURE' | 'ANNOUNCEMENT';

export function eventCategory(type: EventType): EventCategory {
  switch (type) {
    case 'SIGNAL_PUBLISHED':
      return 'NEW_SIGNAL';
    case 'TRADE_CLOSED':
    case 'TRADE_CANCELLED':
    case 'ENTRY_EXPIRED':
      return 'CLOSURE';
    case 'ANNOUNCEMENT':
      return 'ANNOUNCEMENT';
    default:
      return 'UPDATE';
  }
}

export const CLOSE_REASONS = [
  'TARGET_ACHIEVED',
  'STOP_LOSS_HIT',
  'MANUAL',
  'BREAKEVEN',
  'INVALIDATED',
  'OTHER',
] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];

export const CLOSE_REASON_LABELS: Record<CloseReason, string> = {
  TARGET_ACHIEVED: 'Target achieved',
  STOP_LOSS_HIT: 'Stop-loss hit',
  MANUAL: 'Manual close',
  BREAKEVEN: 'Breakeven',
  INVALIDATED: 'Strategy invalidated',
  OTHER: 'Other',
};

export const PRIORITIES = ['NORMAL', 'PRIORITY'] as const;
export type Priority = (typeof PRIORITIES)[number];
