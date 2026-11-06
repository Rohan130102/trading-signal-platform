import type { EventPayload, EventSnapshot, TargetState } from './lifecycle.js';
import type { CalculationBasis, TradeAggregate } from './pnl.js';
import type { Direction, EntryType } from './signal.js';
import type { CloseReason, EventCategory, EventType, Priority, TradeStatus } from './status.js';
import type { AccessDenial, Role, SubscriptionState, UserStatus } from './subscription.js';
import type { TemplateTone } from './templates.js';

/** Response shapes. The API constructs these explicitly; nothing else crosses the boundary. */

export interface FeedEvent {
  seq: number;
  id: string;
  tradeId: string | null;
  tradeVersion: number | null;
  type: EventType;
  category: EventCategory;
  tone: TemplateTone;
  priority: Priority;
  title: string;
  body: string;
  payload: EventPayload;
  /** Current state of the parent trade, which may be newer than this event. */
  tradeStatus: TradeStatus | null;
  createdAt: string;
}

export interface FeedPage {
  events: FeedEvent[];
  /** Highest broadcast sequence at the time of the query, so a client can resume from it. */
  headSeq: number;
  lastReadSeq: number;
  unread: number;
  hasMore: boolean;
}

export interface TradeSummary {
  id: string;
  ref: string;
  symbol: string;
  displayName: string;
  pricePrecision: number;
  quoteCurrency: string;
  unitLabel: string;
  pointSize: string;
  direction: Direction;
  entryType: EntryType;
  entryLow: string;
  entryHigh: string;
  stopLoss: string;
  originalStopLoss: string;
  targets: TargetState[];
  status: TradeStatus;
  priority: Priority;
  closedFraction: string;
  version: number;
  publishedAt: string;
  activatedAt: string | null;
  closedAt: string | null;
  entryExpiresAt: string | null;
  commentary: string | null;
  lastEventAt: string | null;
  lastEventTitle: string | null;
  updatesCount: number;
}

/** Outcome as a subscriber sees it: movement and basis only, never position or money. */
export interface PublicOutcome {
  basis: CalculationBasis;
  closedFraction: string;
  averageExit: string | null;
  weightedPoints: string | null;
  outcome: TradeAggregate['outcome'];
  reason: CloseReason | null;
}

export interface TradeDetail extends TradeSummary {
  events: FeedEvent[];
  outcome: PublicOutcome | null;
}

export interface AdminClosure {
  id: string;
  kind: 'PARTIAL' | 'FINAL';
  fraction: string;
  quantity: string | null;
  exitPrice: string;
  exitedAt: string;
  reason: CloseReason | null;
  basis: CalculationBasis;
  entryPriceUsed: string | null;
  multiplierUsed: string | null;
  fees: string | null;
  priceMove: string | null;
  points: string | null;
  grossPnl: string | null;
  netPnl: string | null;
  methodologyVersion: string;
  superseded: boolean;
  createdAt: string;
}

export interface DispatchSummary {
  eventId: string;
  seq: number;
  /** Stage of the outbox job that expands this event into per-device push attempts. */
  stage: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  devices: number;
  /** Accepted by the push service. This does NOT mean the subscriber saw it. */
  accepted: number;
  pending: number;
  failed: number;
  invalidated: number;
  skipped: number;
  /** Connected subscribers the live event was written to, across API instances. */
  liveSends: number;
}

export interface AdminEvent extends FeedEvent {
  actorName: string | null;
  broadcast: boolean;
  dispatch: DispatchSummary | null;
}

export interface AdminTradeDetail extends Omit<TradeSummary, never> {
  events: AdminEvent[];
  closures: AdminClosure[];
  aggregate: TradeAggregate | null;
  execution: { basis: string; entryPrice: string; quantity: string | null } | null;
  allowedActions: string[];
  contractMultiplier: string | null;
  tickSize: string;
}

export interface SubscriptionView {
  state: SubscriptionState;
  startsAt: string | null;
  expiresAt: string | null;
  /** Inclusive last calendar date in the business timezone. */
  lastValidDate: string | null;
  daysRemaining: number;
  timezone: string;
}

export interface MeResponse {
  id: string;
  name: string;
  loginId: string;
  role: Role;
  /** The step this session must complete before anything else. */
  next: 'CHANGE_PASSWORD' | 'MFA_SETUP' | 'MFA_VERIFY' | null;
  mfaEnabled: boolean;
  subscription: SubscriptionView;
  access: { allowed: boolean; reason: AccessDenial | null };
  support: { contact: string; renewalInstructions: string; serviceName: string };
}
export type { EventPayload, EventSnapshot, UserStatus };
