import type { EventPayload, EventSnapshot, TargetState } from './lifecycle.js';
import type { InstrumentSpec } from './instrument.js';
import type { CalculationBasis, PerformanceStats, TradeAggregate } from './pnl.js';
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

export interface TokenLoginResponse {
  /** Shown once. Store it in the device's secure storage and send it as a bearer token. */
  token: string;
  expiresAt: string;
}

export interface PushConfig {
  available: boolean;
  publicKey: string | null;
  mode: string;
  /** Whether the server can send to native devices. */
  nativeAvailable: boolean;
}

export interface PushDevice {
  id: string;
  deviceLabel: string | null;
  channel: 'WEB_PUSH' | 'EXPO';
  platform: string | null;
  createdAt: string;
  lastAcceptedAt: string | null;
  thisDevice: boolean;
}

export interface NotificationPreferences {
  pushNewSignals: boolean;
  pushUpdates: boolean;
  pushClosures: boolean;
  pushAnnouncements: boolean;
  hidePreview: boolean;
}

export interface HistoryPage {
  trades: (TradeSummary & { outcome: PublicOutcome | null })[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminTradesPage {
  trades: (TradeSummary & { aggregate: TradeAggregate | null })[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DashboardResponse {
  active: (TradeSummary & { aggregate: TradeAggregate | null })[];
  awaitingEntry: (TradeSummary & { aggregate: TradeAggregate | null })[];
  recentlyClosed: (TradeSummary & { aggregate: TradeAggregate | null })[];
  recentEvents: {
    seq: number;
    id: string;
    tradeId: string | null;
    title: string;
    type: string;
    tone: string;
    createdAt: string;
    dispatch: DispatchSummary | null;
  }[];
  drafts: number;
  subscribers: { total: number; active: number; expired: number; expiringSoon: number };
  expiring: { id: string; name: string; loginId: string; expiresAt: string | null }[];
  health: {
    status: string;
    worker: { healthy: boolean; lastSeenSecondsAgo: number | null };
    outbox: { pending: number; dead: number };
    push: { transport: string };
  };
  alerts: { level: 'WARNING' | 'CRITICAL'; message: string; href: string }[];
}

export interface NotificationHealth {
  status: 'HEALTHY' | 'ATTENTION';
  worker: { healthy: boolean; lastSeenSecondsAgo: number | null; instances: number };
  outbox: { pending: number; dead: number; oldestPendingSeconds: number | null };
  push: {
    transport: string;
    nativeAvailable: boolean;
    last24h: { accepted: number; pending: number; failed: number; invalidated: number; skipped: number };
    note: string;
  };
  live: {
    last24h: { samples: number; p50Ms: number | null; p95Ms: number | null; maxMs: number | null };
    sloTargetP95Ms: number;
    note: string;
  };
  recentFailures: {
    id: string;
    attempts: number;
    statusCode: number | null;
    error: string | null;
    at: string;
    title: string;
    tradeId: string | null;
  }[];
}

export interface SubscriberRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  loginId: string;
  status: UserStatus;
  notes: string | null;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  subscription: SubscriptionView;
}

export interface SubscriberDetail extends SubscriberRow {
  events: {
    id: string;
    type: string;
    mode: string | null;
    durationDays: number | null;
    lastValidDate: string;
    note: string | null;
    actorName: string;
    createdAt: string;
  }[];
  devices: { id: string; deviceLabel: string | null; createdAt: string; lastAcceptedAt: string | null }[];
  sessions: { id: string; deviceLabel: string | null; lastSeenAt: string }[];
}

export interface SubscribersPage {
  subscribers: SubscriberRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PerformanceReport {
  lifecycle: PerformanceStats;
  byBasis: { basis: CalculationBasis; stats: PerformanceStats }[];
  byInstrument: { symbol: string; byBasis: { basis: CalculationBasis; stats: PerformanceStats }[] }[];
  records: (TradeSummary & { aggregate: TradeAggregate | null; corrected: boolean })[];
  truncated: boolean;
  quoteCurrency: string | null;
  pointsComparable: boolean;
  methodology: { version: string; statements: string[] };
}

export interface InstrumentRow extends InstrumentSpec {
  id: string;
  active: boolean;
  sortOrder: number;
}

export interface TemplateRow {
  id: string;
  kind: string;
  name: string;
  tone: string;
  title: string;
  body: string;
  active: boolean;
  favorite: boolean;
  isDefault: boolean;
}

export type { EventPayload, EventSnapshot, UserStatus };
