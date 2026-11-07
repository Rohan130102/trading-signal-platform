import { z } from 'zod';
import { CALCULATION_BASES } from './pnl.js';
import { DIRECTIONS, ENTRY_TYPES, MAX_TARGETS } from './signal.js';
import { CLOSE_REASONS, PRIORITIES, TRADE_STATUSES, EVENT_TYPES } from './status.js';
import { MAX_SUBSCRIPTION_DAYS } from './subscription.js';
import { TEMPLATE_KINDS, TEMPLATE_TONES } from './templates.js';

/**
 * Request contracts shared by the API (authoritative validation) and the web app (inline feedback).
 * Objects are strict, so an unexpected field is rejected rather than silently ignored. Numbers that
 * carry money or prices travel as strings.
 */

const decimalLiteral = /^\d{1,14}(\.\d{1,8})?$/;
export const priceSchema = z.string().trim().regex(decimalLiteral, 'Enter a plain number such as 3300.50');
export const pointsSchema = priceSchema;
const shortText = (max: number) => z.string().trim().max(max);
const comment = shortText(1000).optional();
export const idempotencyKeySchema = z.uuid();
export const expectedVersionSchema = z.number().int().min(0);
const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'That date does not exist');
const instant = z.iso.datetime({ offset: true });

/* ---------- Authentication ---------- */

const passwordSchema = z.string().min(10, 'Use at least 10 characters').max(200, 'Use at most 200 characters');

export const loginSchema = z.strictObject({
  identifier: z.string().trim().min(1, 'Enter your login ID').max(200),
  password: z.string().min(1, 'Enter your password').max(200),
});
/** Native clients: the session token comes back in the body rather than as a cookie. */
export const tokenLoginSchema = z.strictObject({
  identifier: z.string().trim().min(1, 'Enter your login ID').max(200),
  password: z.string().min(1, 'Enter your password').max(200),
  deviceLabel: z.string().trim().max(120).optional(),
});
export const changePasswordSchema = z.strictObject({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});
export const mfaCodeSchema = z.strictObject({
  code: z.string().trim().min(6).max(32),
});

/* ---------- Instruments ---------- */

export const instrumentSchema = z.strictObject({
  symbol: z
    .string()
    .trim()
    .min(2)
    .max(24)
    .regex(/^[A-Z0-9/._-]+$/, 'Use capitals, digits and / . _ -'),
  displayName: z.string().trim().min(1).max(80),
  assetClass: z.enum(['CRYPTO', 'COMMODITY', 'FOREX', 'INDEX', 'EQUITY', 'OTHER']),
  quoteCurrency: z.string().trim().min(2).max(8),
  pricePrecision: z.number().int().min(0).max(8),
  tickSize: priceSchema,
  pointSize: priceSchema,
  defaultTargetPoints: pointsSchema,
  defaultStopPoints: pointsSchema,
  defaultTarget2Points: pointsSchema.nullable().default(null),
  defaultTarget3Points: pointsSchema.nullable().default(null),
  contractMultiplier: priceSchema.nullable().default(null),
  unitLabel: z.string().trim().min(1).max(16),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(100000).default(100),
});
export type InstrumentInput = z.infer<typeof instrumentSchema>;

/* ---------- Signals ---------- */

export const signalFieldsSchema = z.strictObject({
  instrumentId: z.uuid(),
  direction: z.enum(DIRECTIONS),
  entryType: z.enum(ENTRY_TYPES),
  entryLow: priceSchema,
  /** For a single entry this equals entryLow. */
  entryHigh: priceSchema,
  targets: z.array(priceSchema).min(1).max(MAX_TARGETS),
  stopLoss: priceSchema,
  priority: z.enum(PRIORITIES).default('NORMAL'),
  templateId: z.uuid().nullable().optional(),
  commentary: comment,
  /** Optional deadline after which an unfilled signal expires. */
  entryExpiresAt: instant.nullable().optional(),
});
export type SignalFields = z.infer<typeof signalFieldsSchema>;

export const publishSignalSchema = signalFieldsSchema.extend({
  idempotencyKey: idempotencyKeySchema,
  draftId: z.uuid().nullable().optional(),
  draftVersion: expectedVersionSchema.optional(),
  /** Set after the administrator has seen and accepted a duplicate-signal warning. */
  confirmDuplicate: z.boolean().default(false),
});

/** Drafts may be incomplete: only publication requires the full signal. */
export const draftSchema = z.strictObject({
  instrumentId: z.uuid().nullable().optional(),
  direction: z.enum(DIRECTIONS).nullable().optional(),
  entryType: z.enum(ENTRY_TYPES).nullable().optional(),
  entryLow: z.string().max(32).nullable().optional(),
  entryHigh: z.string().max(32).nullable().optional(),
  targets: z.array(z.string().max(32)).max(MAX_TARGETS).optional(),
  stopLoss: z.string().max(32).nullable().optional(),
  priority: z.enum(PRIORITIES).optional(),
  templateId: z.uuid().nullable().optional(),
  commentary: comment,
});
export type DraftInput = z.infer<typeof draftSchema>;

export const previewSignalSchema = signalFieldsSchema;

/* ---------- Trade commands ---------- */

const commandBase = {
  /** The version of the trade the administrator was looking at. A stale version is rejected. */
  expectedVersion: expectedVersionSchema,
  idempotencyKey: idempotencyKeySchema,
};
const executionBasis = z.enum(['HYPOTHETICAL_OUTCOME', 'ADMIN_DECLARED_EXECUTION', 'NONE']);
const closureOutcome = {
  exitPrice: priceSchema,
  exitedAt: instant.optional(),
  basis: executionBasis,
  /** Entry for a hypothetical outcome. Required when the recommendation was a range. */
  hypotheticalEntry: priceSchema.optional(),
  fees: priceSchema.optional(),
  comment,
};

export const tradeCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('ACTIVATE'),
    ...commandBase,
    /** Optional administrator-declared fill. Without it the trade is active but has no execution record. */
    actualEntry: priceSchema.optional(),
    quantity: priceSchema.optional(),
    comment,
  }),
  z.strictObject({
    action: z.literal('RECORD_EXECUTION'),
    ...commandBase,
    actualEntry: priceSchema,
    quantity: priceSchema.optional(),
  }),
  z.strictObject({
    action: z.literal('MOVE_STOP'),
    ...commandBase,
    price: priceSchema,
    /** Moving a stop further from the entry raises risk, so it needs explicit confirmation. */
    allowWiden: z.boolean().default(false),
    comment,
  }),
  z.strictObject({
    action: z.literal('MOVE_STOP_BREAKEVEN'),
    ...commandBase,
    /** Needed only when no entry is known, i.e. a range entry with no recorded fill. */
    price: priceSchema.optional(),
    comment,
  }),
  z.strictObject({
    action: z.literal('TRAIL_STOP'),
    ...commandBase,
    referencePrice: priceSchema,
    trailPoints: pointsSchema,
    comment,
  }),
  z.strictObject({
    action: z.literal('TARGET_HIT'),
    ...commandBase,
    targetIndex: z.number().int().min(1).max(MAX_TARGETS),
    comment,
  }),
  z.strictObject({
    action: z.literal('MODIFY_TARGETS'),
    ...commandBase,
    /** New prices for targets not yet reached, nearest first. */
    targets: z.array(priceSchema).max(MAX_TARGETS),
    comment,
  }),
  z.strictObject({
    action: z.literal('BOOK_PARTIAL'),
    ...commandBase,
    ...closureOutcome,
    /** Share of the original position closed by this exit. Give one of percent or quantity. */
    percent: z
      .string()
      .trim()
      .regex(/^\d{1,3}(\.\d{1,4})?$/, 'Enter a percentage')
      .optional(),
    quantity: priceSchema.optional(),
  }),
  z.strictObject({
    action: z.literal('CLOSE'),
    ...commandBase,
    ...closureOutcome,
    reason: z.enum(CLOSE_REASONS),
    confirm: z.literal(true),
  }),
  z.strictObject({
    action: z.literal('URGENT'),
    ...commandBase,
    message: z.string().trim().min(1, 'Write the instruction').max(1000),
  }),
  z.strictObject({
    action: z.literal('CANCEL'),
    ...commandBase,
    comment,
  }),
  z.strictObject({
    action: z.literal('EXPIRE'),
    ...commandBase,
    comment,
  }),
  z.strictObject({
    action: z.literal('CORRECT'),
    ...commandBase,
    reason: z.string().trim().min(3, 'Explain the correction').max(500),
    entryLow: priceSchema.optional(),
    entryHigh: priceSchema.optional(),
    stopLoss: priceSchema.optional(),
    targets: z.array(priceSchema).min(1).max(MAX_TARGETS).optional(),
    closureId: z.uuid().optional(),
    exitPrice: priceSchema.optional(),
    fees: priceSchema.nullable().optional(),
  }),
]);
export type TradeCommand = z.infer<typeof tradeCommandSchema>;

export const announcementSchema = z.strictObject({
  title: shortText(120).optional(),
  message: z.string().trim().min(1, 'Write the update').max(2000),
  priority: z.enum(PRIORITIES).default('NORMAL'),
  idempotencyKey: idempotencyKeySchema,
});

/* ---------- Templates ---------- */

export const templateUpdateSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  tone: z.enum(TEMPLATE_TONES),
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(2000),
  active: z.boolean(),
  favorite: z.boolean(),
});
export const templateKindSchema = z.enum(TEMPLATE_KINDS);

/* ---------- Subscribers ---------- */

const contactEmail = z.email().max(200).nullable().optional();
const contactPhone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{6,24}$/, 'Enter a valid phone number')
  .nullable()
  .optional();
const loginId = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[a-zA-Z0-9._@+-]+$/, 'Use letters, digits and . _ @ + -');

export const createSubscriberSchema = z.strictObject({
  name: z.string().trim().min(1, 'Enter a name').max(120),
  email: contactEmail,
  phone: contactPhone,
  loginId,
  durationDays: z.number().int().min(1).max(MAX_SUBSCRIPTION_DAYS),
  /** Local calendar date in the business timezone. Defaults to now. */
  activationDate: localDate.optional(),
  notes: shortText(2000).nullable().optional(),
  idempotencyKey: idempotencyKeySchema,
});
export const updateSubscriberSchema = z.strictObject({
  name: z.string().trim().min(1).max(120).optional(),
  email: contactEmail,
  phone: contactPhone,
  notes: shortText(2000).nullable().optional(),
});
export const renewSubscriptionSchema = z.strictObject({
  durationDays: z.number().int().min(1).max(MAX_SUBSCRIPTION_DAYS),
  idempotencyKey: idempotencyKeySchema,
  note: shortText(500).optional(),
});
export const adjustSubscriptionSchema = z.strictObject({
  /** Last local calendar date of access, inclusive. */
  lastValidDate: localDate.optional(),
  /** Exact instant the subscription ends. Mutually exclusive with lastValidDate. */
  expiresAt: instant.optional(),
  activationDate: localDate.optional(),
  note: z.string().trim().min(3, 'Say why the dates are changing').max(500),
  idempotencyKey: idempotencyKeySchema,
});
export const accountActionSchema = z.strictObject({
  note: shortText(500).optional(),
});

export const listSubscribersQuery = z.object({
  q: z.string().trim().max(120).optional(),
  access: z.enum(['ACTIVE', 'EXPIRING', 'EXPIRED', 'SCHEDULED', 'SUSPENDED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/* ---------- Feed and history ---------- */

export const feedQuery = z.object({
  /** Newest-first page: events older than this sequence. */
  before: z.coerce.number().int().min(0).optional(),
  /** Oldest-first catch-up: events newer than this sequence. */
  after: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  symbol: z.string().trim().max(24).optional(),
});
export const markReadSchema = z.strictObject({ seq: z.number().int().min(0) });

export const historyQuery = z.object({
  q: z.string().trim().max(60).optional(),
  symbol: z.string().trim().max(24).optional(),
  status: z.enum(TRADE_STATUSES).optional(),
  from: localDate.optional(),
  to: localDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const adminTradesQuery = historyQuery.extend({
  live: z.enum(['true', 'false']).optional(),
});
export const eventTypeSchema = z.enum(EVENT_TYPES);

/* ---------- Notifications ---------- */

export const pushSubscribeSchema = z.strictObject({
  endpoint: z
    .url()
    .max(2000)
    .refine(
      (u) => u.startsWith('https://') || u.startsWith('http://localhost') || u.startsWith('http://127.0.0.1'),
      'Push endpoint must use HTTPS',
    ),
  keys: z.strictObject({ p256dh: z.string().min(16).max(256), auth: z.string().min(8).max(256) }),
  deviceLabel: shortText(120).optional(),
});
export const pushUnsubscribeSchema = z.strictObject({ endpoint: z.string().max(2000) });
const expoPushToken = z
  .string()
  .trim()
  .regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,200}\]$/, 'That is not a valid device token');
export const registerDeviceSchema = z.strictObject({
  token: expoPushToken,
  platform: z.enum(['ios', 'android']),
  deviceLabel: z.string().trim().max(120).optional(),
});
export const unregisterDeviceSchema = z.strictObject({ token: expoPushToken });
export const preferencesSchema = z.strictObject({
  pushNewSignals: z.boolean(),
  pushUpdates: z.boolean(),
  pushClosures: z.boolean(),
  pushAnnouncements: z.boolean(),
  hidePreview: z.boolean(),
});

/* ---------- Settings and compliance ---------- */

export const settingsSchema = z.strictObject({
  serviceName: z.string().trim().min(1).max(80),
  businessTimezone: z.string().trim().min(1).max(64),
  supportContact: shortText(300),
  renewalInstructions: shortText(1000),
  legalEntityName: shortText(200),
  regulatoryStatement: shortText(2000),
  riskDisclosure: shortText(5000),
  privacyNotice: shortText(5000),
  serviceDescription: shortText(2000),
  entryExpiryHoursDefault: z
    .number()
    .int()
    .min(0)
    .max(24 * 30),
});
export type SettingsInput = z.infer<typeof settingsSchema>;

export const approvalSchema = z.strictObject({
  jurisdiction: z.string().trim().min(2).max(120),
  scope: z.string().trim().min(3).max(500),
  reviewerName: z.string().trim().min(3).max(160),
  documentReference: z.string().trim().min(3).max(500),
  effectiveFrom: instant,
  expiresAt: instant,
  notes: shortText(2000).optional(),
});

export const performanceQuery = z.object({
  from: localDate.optional(),
  to: localDate.optional(),
  symbol: z.string().trim().max(24).optional(),
  basis: z.enum(CALCULATION_BASES).optional(),
});

export const auditQuery = z.object({
  action: z.string().trim().max(80).optional(),
  actorId: z.uuid().optional(),
  targetId: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

/* ---------- Realtime protocol ---------- */

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('hello'), lastSeq: z.number().int().min(0) }),
  z.strictObject({ type: z.literal('ping') }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
