import type { DraftInput } from './contracts.js';
import type { EventPayload, EventSnapshot, TargetState } from './lifecycle.js';
import type { InstrumentSpec } from './instrument.js';
import type { CalculationBasis, PerformanceStats, TradeAggregate } from './pnl.js';
import type { Direction, EntryType } from './signal.js';
import type { CloseReason, EventCategory, EventType, Priority, TradeStatus } from './status.js';
import type {
  AccessDenial,
  Role,
  SubscriberAction,
  SubscriptionKind,
  SubscriptionState,
  UserStatus,
} from './subscription.js';
import type { EnquiryChannel, EnquiryOutcome, EnquiryStatus } from './support.js';
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
  /** Null for an upcoming trade, which has no stop-loss or target until it is activated. */
  stopLoss: string | null;
  originalStopLoss: string | null;
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
  /** This subscriber hid it from their Signals list. */
  hidden?: boolean;
  /** An administrator moved it out of the Signals list. */
  archived?: boolean;
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
  archivedAt: string | null;
  /** Taken off subscriber screens by the Master Admin. Still counted in performance figures. */
  removal: { removedAt: string; removedBy: string; reason: string } | null;
}

export interface SubscriptionView {
  state: SubscriptionState;
  /** Null when there has never been a subscription or trial. */
  kind: SubscriptionKind | null;
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
  support: SupportContact;
  /** Where this person's subscription enquiry stands. Separate from access. */
  enquiryStatus: EnquiryStatus;
  /** What goes into an enquiry. Null for administrators. */
  profile: { firstName: string; lastName: string; email: string; mobile: string } | null;
  /** A newly granted trial not yet welcomed on any device. */
  trialGreeting: { grantId: string; durationDays: number; lastValidDate: string } | null;
  /** When this person finished or skipped the first-use tour. Null shows it. */
  onboardedAt: string | null;
  /** Registers and manages administrators and changes platform rules. */
  isMasterAdmin: boolean;
  /** The platform's rule for this person, set by the Master Admin. Applied by the app as far as the OS allows. */
  security: { screenshotsAllowed: boolean };
}

/** Read from settings on every request, so a change by the Master Admin applies at once. */
export interface SupportContact {
  serviceName: string;
  whatsapp: string;
  email: string;
  /** Free text kept from earlier versions, such as office hours. */
  contact: string;
  renewalInstructions: string;
}

/** What anyone may read, signed in or not. */
export interface PublicInfo {
  serviceName: string;
  serviceDescription: string;
  legalEntityName: string;
  regulatoryStatement: string;
  riskDisclosure: string;
  privacyNotice: string;
  supportContact: string;
  supportWhatsapp: string;
  supportEmail: string;
  publicResultsAvailable: boolean;
  /** The About section of the public page. */
  aboutBody: string;
  /** When demonstration data was last cleared. Results start after it. */
  dataResetAt: string | null;
  /** The Super Admin allows sign-up. */
  signupOpen: boolean;
  /** Sign-up is open and a code can be emailed. When false the sign-up screen says so before asking anything. */
  signupAvailable: boolean;
}

/** One finished trade on the public page. Times are when the desk published, activated and closed it. */
export interface PublicTradeRecord {
  ref: string | null;
  symbol: string;
  direction: Direction | null;
  status: TradeStatus;
  publishedAt: string | null;
  /** When the desk marked the signal active. Not a fill, and not a subscriber's execution. */
  activatedAt: string | null;
  /** Time of the last recorded exit. */
  exitedAt: string | null;
  closedAt: string | null;
  basis: CalculationBasis | null;
  weightedPoints: string | null;
  outcome: TradeAggregate['outcome'] | null;
  /** The record was corrected after publication. The history shows what changed and why. */
  corrected: boolean;
}

export interface PublicPerformanceResponse {
  measurementPeriod: { from: string | null; to: string | null };
  lifecycle: Omit<PerformanceStats, 'grossPnl' | 'netPnl' | 'averageWinNet' | 'averageLossNet' | 'monetaryTrades'>;
  hypothetical: Omit<PerformanceStats, 'grossPnl' | 'netPnl' | 'averageWinNet' | 'averageLossNet' | 'monetaryTrades'>;
  declared: Omit<PerformanceStats, 'grossPnl' | 'netPnl' | 'averageWinNet' | 'averageLossNet' | 'monetaryTrades'>;
  records: PublicTradeRecord[];
  /** Finished trades taken off subscriber screens. They are still counted in every figure above. */
  removedFromScreens: number;
  symbols: string[];
  pointsComparable: boolean;
  dataResetAt: string | null;
  methodology: { version: string; statements: string[]; definitions: { term: string; meaning: string }[] };
  disclosures: {
    riskDisclosure: string;
    regulatoryStatement: string;
    approval: { jurisdiction: string; scope: string; documentReference: string; expiresAt: string };
  };
}

export interface DraftRow {
  id: string;
  version: number;
  draft: DraftInput;
  updatedAt: string;
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
  trades: (TradeSummary & { outcome: PublicOutcome | null; hidden?: boolean; archived?: boolean })[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminTradesPage {
  trades: (TradeSummary & {
    aggregate: TradeAggregate | null;
    archivedAt: string | null;
    /** Taken off subscriber screens by the Master Admin. */
    removedAt: string | null;
  })[];
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

export interface LatencyStats {
  samples: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
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
  /** Measured from records, never estimated. Null where there are no samples. */
  timings: {
    /** Commit of the event until the worker created its deliveries. */
    queue: LatencyStats;
    /** Commit of the event until the push service accepted the message. */
    providerAcceptance: LatencyStats;
    /** Commit of the event until someone opened the notification on a phone. */
    opened: LatencyStats & { opens: number };
    note: string;
  };
  /** Conditions that need someone to look, in plain words. Empty when all is well. */
  alerts: string[];
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
  firstName: string | null;
  lastName: string | null;
  age: number | null;
  /** Self-registered accounts only. Accounts an administrator created have none. */
  emailVerifiedAt: string | null;
  selfRegistered: boolean;
  enquiryStatus: EnquiryStatus;
  email: string | null;
  phone: string | null;
  loginId: string;
  status: UserStatus;
  notes: string | null;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  subscription: SubscriptionView;
  /** This subscriber's own screenshot permission. Null follows the platform default. */
  screenshotsAllowed: boolean | null;
  /** What applies to them now. */
  screenshotsEffective: boolean;
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
  /** Which subscription actions apply now. */
  actions: SubscriberAction[];
  trials: { id: string; durationDays: number; lastValidDate: string; note: string | null; createdAt: string }[];
  enquiries: { id: string; channel: EnquiryChannel; outcome: EnquiryOutcome; createdAt: string }[];
}

export interface RegistrationRow {
  id: string;
  name: string;
  email: string | null;
  mobile: string | null;
  age: number | null;
  registeredAt: string;
  emailVerified: boolean;
  enquiryStatus: EnquiryStatus;
  subscription: SubscriptionView;
  /** Not yet opened by an administrator. */
  isNew: boolean;
}

export interface RegistrationsPage {
  registrations: RegistrationRow[];
  total: number;
  unseen: number;
  page: number;
  pageSize: number;
}

export const PASSWORD_RESET_STATUSES = ['OPEN', 'PASSWORD_ISSUED', 'COMPLETED', 'DISMISSED'] as const;
export type PasswordResetStatus = (typeof PASSWORD_RESET_STATUSES)[number];

export interface PasswordResetRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  loginId: string;
  requestedAt: string;
  emailVerified: boolean;
  status: PasswordResetStatus;
  issuedAt: string | null;
  completedAt: string | null;
}

/** Counts behind the administrator's badges. */
export interface AdminInbox {
  newRegistrations: number;
  openPasswordResets: number;
}

/** A message to one person about their own account, such as a subscription starting. */
export interface UserNotice {
  id: string;
  kind: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}

/** The answer to a sign-up or recovery step. The same whether or not an account exists. */
export interface ChallengeResponse {
  challengeId: string;
  email: string;
  resendAvailableAt: string;
  expiresAt: string;
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
  /** Finished trades taken off subscriber screens. Counted in every figure above. */
  removedFromScreens: number;
}

export interface InstrumentRow extends InstrumentSpec {
  id: string;
  active: boolean;
  sortOrder: number;
  exchange: string | null;
  /** Archived instruments cannot be used for new signals. Their trades keep their history. */
  archivedAt: string | null;
  /** Published trades on this instrument. */
  tradeCount: number;
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
