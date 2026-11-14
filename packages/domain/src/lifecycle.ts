import type { TradeCommand } from './contracts.js';
import { canon, Dec, type DecimalString, toDec } from './decimal.js';
import {
  formatPoints,
  formatPrice,
  type InstrumentSpec,
  type Issue,
  isOnTick,
  pointsToPriceDistance,
  validatePrice,
} from './instrument.js';
import { type CalculationBasis, type ClosureResult, computeClosureResult } from './pnl.js';
import {
  type Direction,
  type EntryLevels,
  MAX_TARGETS,
  singleEntry,
  validateEntryAndTargets,
  validateSignalLevels,
} from './signal.js';
import {
  ACTION_FROM,
  canTransition,
  CLOSE_REASON_LABELS,
  type CloseReason,
  type EventType,
  type Priority,
  STATUS_LABELS,
  type TradeStatus,
} from './status.js';
import type { TemplateContext, TemplateKind } from './templates.js';

export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly issues: Issue[] = [],
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export interface TargetState {
  index: number;
  price: DecimalString;
  /** Price as first published, kept so that changes stay visible. */
  originalPrice: DecimalString | null;
  status: 'OPEN' | 'HIT';
  hitAt: string | null;
}

export interface ExecutionState {
  basis: 'ADMIN_DECLARED_EXECUTION';
  entryPrice: DecimalString;
  /** Null when only the fill price is known. Monetary P&L then stays unavailable. */
  quantity: DecimalString | null;
}

/** A closure as held in the database. Quantity, fees and P&L never go into a broadcast payload. */
export interface ClosureState extends ClosureResult {
  id: string;
  kind: 'PARTIAL' | 'FINAL';
  fraction: DecimalString;
  quantity: DecimalString | null;
  exitPrice: DecimalString;
  exitedAt: string;
  reason: CloseReason | null;
  basis: CalculationBasis;
  entryPriceUsed: DecimalString | null;
  multiplierUsed: DecimalString | null;
  fees: DecimalString | null;
}

export interface TradeState {
  ref: string;
  status: TradeStatus;
  version: number;
  spec: InstrumentSpec;
  direction: Direction;
  entry: EntryLevels;
  /** Null only for an upcoming range trade, published before its levels: it gets them when activated. */
  originalStopLoss: DecimalString | null;
  stopLoss: DecimalString | null;
  targets: TargetState[];
  closedFraction: DecimalString;
  closureBasis: CalculationBasis | null;
  execution: ExecutionState | null;
  /** When the signal was published. Optional so that older callers need not supply it. */
  publishedAt?: string | null;
  activatedAt: string | null;
  closedAt: string | null;
  closures: ClosureState[];
}

/** Shown on every event so a card can be drawn without further lookups. */
export interface EventSnapshot {
  status: TradeStatus;
  stopLoss: DecimalString | null;
  targets: { index: number; price: DecimalString; status: 'OPEN' | 'HIT' }[];
  closedFraction: DecimalString;
}

export interface EventPayload {
  ref?: string;
  symbol?: string;
  direction?: Direction;
  pricePrecision?: number;
  after?: EventSnapshot;
  comment?: string | null;
  // SIGNAL_PUBLISHED
  entryType?: EntryLevels['type'];
  entryLow?: DecimalString;
  entryHigh?: DecimalString;
  priority?: Priority;
  // STOP_MOVED
  previousStop?: DecimalString;
  newStop?: DecimalString;
  stopKind?: 'MANUAL' | 'BREAKEVEN' | 'TRAIL';
  trailPoints?: DecimalString;
  referencePrice?: DecimalString;
  // TARGET_HIT
  targetIndex?: number;
  targetPrice?: DecimalString;
  // TARGETS_MODIFIED
  previousTargets?: DecimalString[];
  newTargets?: DecimalString[];
  // ENTRY_ACTIVATED / EXECUTION_RECORDED
  activationPrice?: DecimalString;
  quantity?: DecimalString | null;
  /** ENTRY_ACTIVATED of an upcoming trade: the levels it was activated with. */
  finalEntry?: DecimalString;
  activatedTargets?: DecimalString[];
  activatedStop?: DecimalString;
  // PARTIAL_BOOKED / TRADE_CLOSED
  exitPrice?: DecimalString;
  exitedAt?: string;
  fraction?: DecimalString;
  remainingFraction?: DecimalString;
  reason?: CloseReason;
  basis?: CalculationBasis;
  movementPoints?: DecimalString | null;
  // URGENT_INSTRUCTION / ANNOUNCEMENT
  title?: string;
  message?: string;
  announcementId?: string;
  category?: string;
  // CORRECTION
  correctionReason?: string;
  changes?: { field: string; from: string | null; to: string | null }[];
  correctedEntry?: { low: DecimalString; high: DecimalString };
  correctedStop?: DecimalString;
  correctedTargets?: DecimalString[];
  /** Every target's price after the correction, in order. Reached states are unchanged. */
  correctedTargetPrices?: DecimalString[];
  correctedActivatedAt?: string;
  /** Set when recording the actual entry re-measured the exits on a new basis. */
  correctedBasis?: CalculationBasis;
  correctedClosureId?: string;
}

export interface DecidedEvent {
  type: EventType;
  broadcast: boolean;
  payload: EventPayload;
  templateKind: TemplateKind | null;
  templateContext: TemplateContext;
}

export interface NewClosure extends Omit<ClosureState, 'id'> {
  supersedesClosureId?: string;
}

export interface Decision {
  events: DecidedEvent[];
  next: TradeState;
  /** New exit records. A correction can supersede several at once. */
  closures: NewClosure[];
  execution: ExecutionState | null;
}

export function snapshot(state: TradeState): EventSnapshot {
  return {
    status: state.status,
    stopLoss: state.stopLoss,
    targets: state.targets.map(({ index, price, status }) => ({ index, price, status })),
    closedFraction: state.closedFraction,
  };
}

/**
 * Pure state transition for a single event. `decide` builds events and then folds them through this
 * function, so a trade's stored state always equals the replay of its event history.
 */
export function evolve(state: TradeState, type: EventType, payload: EventPayload, at: string): TradeState {
  const next: TradeState = { ...state, version: state.version + 1, targets: state.targets.map((t) => ({ ...t })) };
  switch (type) {
    case 'SIGNAL_PUBLISHED':
      next.status = 'PUBLISHED';
      break;
    case 'ENTRY_ACTIVATED':
      next.status = 'ACTIVE';
      next.activatedAt = at;
      if (payload.finalEntry && payload.activatedStop && payload.activatedTargets) {
        next.entry = { type: 'SINGLE', low: payload.finalEntry, high: payload.finalEntry };
        next.stopLoss = payload.activatedStop;
        next.originalStopLoss = state.originalStopLoss ?? payload.activatedStop;
        next.targets = payload.activatedTargets.map((price, i) => ({
          index: i + 1,
          price,
          originalPrice: price,
          status: 'OPEN' as const,
          hitAt: null,
        }));
      }
      break;
    case 'EXECUTION_RECORDED':
      next.execution = {
        basis: 'ADMIN_DECLARED_EXECUTION',
        entryPrice: payload.activationPrice as string,
        quantity: payload.quantity ?? null,
      };
      break;
    case 'STOP_MOVED':
      next.stopLoss = payload.newStop as string;
      break;
    case 'TARGET_HIT':
      for (const target of next.targets) {
        if (target.index <= (payload.targetIndex as number) && target.status === 'OPEN') {
          target.status = 'HIT';
          target.hitAt = at;
        }
      }
      break;
    case 'TARGETS_MODIFIED': {
      const hit = next.targets.filter((t) => t.status === 'HIT');
      next.targets = [
        ...hit,
        ...(payload.newTargets as string[]).map((price, i) => {
          const index = hit.length + i + 1;
          const original = state.targets.find((t) => t.index === index)?.originalPrice ?? null;
          return { index, price, originalPrice: original, status: 'OPEN' as const, hitAt: null };
        }),
      ];
      break;
    }
    case 'PARTIAL_BOOKED':
      next.status = 'PARTIALLY_CLOSED';
      next.closedFraction = canon(toDec(state.closedFraction).plus(toDec(payload.fraction as string)));
      next.closureBasis = payload.basis ?? state.closureBasis;
      break;
    case 'TRADE_CLOSED':
      next.status = 'CLOSED';
      next.closedFraction = '1';
      next.closureBasis = payload.basis ?? state.closureBasis;
      next.closedAt = at;
      break;
    case 'TRADE_CANCELLED':
      next.status = 'CANCELLED';
      next.closedAt = at;
      break;
    case 'ENTRY_EXPIRED':
      next.status = 'EXPIRED';
      next.closedAt = at;
      break;
    case 'CORRECTION':
      if (payload.correctedEntry) {
        next.entry = { type: state.entry.type, ...payload.correctedEntry };
      }
      if (payload.correctedStop) next.stopLoss = payload.correctedStop;
      if (payload.correctedTargetPrices) {
        const prices = payload.correctedTargetPrices;
        next.targets = next.targets.map((t, i) => ({ ...t, price: prices[i] ?? t.price }));
      }
      if (payload.correctedActivatedAt) next.activatedAt = payload.correctedActivatedAt;
      if (payload.correctedBasis) next.closureBasis = payload.correctedBasis;
      if (payload.correctedTargets) {
        const hit = next.targets.filter((t) => t.status === 'HIT');
        next.targets = [
          ...hit,
          ...payload.correctedTargets.map((price, i) => ({
            index: hit.length + i + 1,
            price,
            originalPrice: state.targets.find((t) => t.index === hit.length + i + 1)?.originalPrice ?? null,
            status: 'OPEN' as const,
            hitAt: null,
          })),
        ];
      }
      break;
    case 'URGENT_INSTRUCTION':
    case 'ANNOUNCEMENT':
      break;
  }
  return next;
}

/** Matches the database scale of a closure's fraction, so repeated exits cannot drift apart. */
const FRACTION_DECIMALS = 12;
const QUANTITY_DECIMALS = 8;
/** Beyond these the figures are a typing mistake, and the NUMERIC columns could not hold them. */
const MAX_MOVE = new Dec('1e15');
const MAX_MONEY = new Dec('1e19');

function fail(code: string, message: string, issues: Issue[] = []): never {
  throw new DomainError(code, message, issues);
}

function requirePrice(spec: InstrumentSpec, value: string, field: string, label: string): void {
  const issues = validatePrice(spec, value, field, label);
  if (issues.length > 0) fail('VALIDATION', issues[0]?.message ?? 'Invalid price', issues);
}

/** An upcoming range trade: published as advance notice, with no target or stop-loss until it is activated. */
export function levelsPending(s: { stopLoss: DecimalString | null }): boolean {
  return s.stopLoss === null;
}

const LEVELS_PENDING_MESSAGE = 'This trade has no target or stop-loss yet. Activate it with its levels first.';

function stopOf(s: TradeState): DecimalString {
  if (s.stopLoss === null) fail('LEVELS_PENDING', LEVELS_PENDING_MESSAGE);
  return s.stopLoss;
}

export function entryLabel(spec: InstrumentSpec, entry: EntryLevels): string {
  return entry.type === 'RANGE'
    ? `${formatPrice(spec, entry.low)} to ${formatPrice(spec, entry.high)}`
    : formatPrice(spec, entry.low);
}

export function fractionLabel(fraction: DecimalString): string {
  return `${toDec(fraction).times(100).toDecimalPlaces(2).toFixed()}%`;
}

function baseContext(s: TradeState): TemplateContext {
  const openOrAll = s.targets;
  return {
    ref: s.ref,
    instrument: s.spec.symbol,
    direction: s.direction,
    entry: entryLabel(s.spec, s.entry),
    stop: s.stopLoss === null ? null : formatPrice(s.spec, s.stopLoss),
    target1: openOrAll[0] ? formatPrice(s.spec, openOrAll[0].price) : null,
    target2: openOrAll[1] ? formatPrice(s.spec, openOrAll[1].price) : null,
    target3: openOrAll[2] ? formatPrice(s.spec, openOrAll[2].price) : null,
    targets: s.targets
      .filter((t) => t.status === 'OPEN')
      .map((t) => formatPrice(s.spec, t.price))
      .join(', '),
  };
}

function basePayload(s: TradeState): EventPayload {
  return { ref: s.ref, symbol: s.spec.symbol, direction: s.direction, pricePrecision: s.spec.pricePrecision };
}

function isWorse(direction: Direction, candidate: Dec, current: Dec): boolean {
  return direction === 'BUY' ? candidate.lessThan(current) : candidate.greaterThan(current);
}

/** A stop must not sit beyond the next target still open, whichever way the trade runs. */
function assertStopConsistent(s: TradeState, stop: string): void {
  const price = toDec(stop);
  const open = s.targets.filter((t) => t.status === 'OPEN').map((t) => toDec(t.price));
  const nearest = open[0];
  if (nearest) {
    const conflict = s.direction === 'BUY' ? !price.lessThan(nearest) : !price.greaterThan(nearest);
    if (conflict) {
      fail(
        'STOP_BEYOND_TARGET',
        `The stop-loss cannot be ${s.direction === 'BUY' ? 'at or above' : 'at or below'} the next open target (${formatPrice(s.spec, nearest)}).`,
      );
    }
  }
  // Before entry: published, or cancelled or expired without ever becoming active.
  if (s.status === 'PUBLISHED' || s.status === 'CANCELLED' || s.status === 'EXPIRED') {
    const conflict =
      s.direction === 'BUY' ? !price.lessThan(toDec(s.entry.low)) : !price.greaterThan(toDec(s.entry.high));
    if (conflict) {
      fail(
        'STOP_SIDE',
        `Before entry, a ${s.direction} stop-loss must stay ${s.direction === 'BUY' ? 'below' : 'above'} the entry.`,
      );
    }
  }
}

function assertTargetOrder(s: TradeState, prices: string[]): void {
  const hit = s.targets.filter((t) => t.status === 'HIT').map((t) => t.price);
  const sequence = [...hit, ...prices];
  if (sequence.length === 0) fail('VALIDATION', 'At least one target is required.');
  if (sequence.length > MAX_TARGETS) fail('VALIDATION', `At most ${MAX_TARGETS} targets are supported.`);
  const issues = validateEntryAndTargets({ spec: s.spec, direction: s.direction, entry: s.entry, targets: sequence });
  if (issues.length > 0) fail('VALIDATION', issues[0]?.message ?? 'Invalid targets', issues);
  const first = prices[0];
  if (first) {
    const stop = toDec(stopOf(s));
    const conflict = s.direction === 'BUY' ? !toDec(first).greaterThan(stop) : !toDec(first).lessThan(stop);
    if (conflict) fail('STOP_BEYOND_TARGET', 'Targets must stay on the profit side of the current stop-loss.');
  }
}

interface ResolvedOutcome {
  basis: CalculationBasis;
  entryPrice: string | null;
}

/**
 * Decides what an outcome may honestly be measured from. A recommended range is never treated as a
 * fill: a hypothetical outcome on a range must name its entry, and a declared outcome must have a
 * recorded execution.
 */
function resolveOutcome(s: TradeState, basis: CalculationBasis, hypotheticalEntry?: string): ResolvedOutcome {
  if (s.closureBasis && s.closureBasis !== basis) {
    fail(
      'BASIS_MISMATCH',
      `Earlier exits on this trade used a different calculation basis (${s.closureBasis}). Mixed bases cannot be aggregated.`,
    );
  }
  if (basis === 'NONE') return { basis, entryPrice: null };
  if (basis === 'ADMIN_DECLARED_EXECUTION') {
    if (!s.execution) {
      fail(
        'EXECUTION_REQUIRED',
        'Record the executed entry before declaring an execution outcome, or choose another basis.',
      );
    }
    return { basis, entryPrice: s.execution.entryPrice };
  }
  if (basis === 'HYPOTHETICAL_OUTCOME') {
    if (hypotheticalEntry !== undefined) {
      requirePrice(s.spec, hypotheticalEntry, 'hypotheticalEntry', 'Hypothetical entry');
      const value = toDec(hypotheticalEntry);
      if (value.lessThan(toDec(s.entry.low)) || value.greaterThan(toDec(s.entry.high))) {
        fail('HYPOTHETICAL_OUTSIDE_RANGE', 'A hypothetical entry must lie within the published recommendation.');
      }
      return { basis, entryPrice: canon(value) };
    }
    if (s.entry.type === 'RANGE') {
      fail(
        'HYPOTHETICAL_ENTRY_REQUIRED',
        'This signal recommended a range. State which entry price the hypothetical outcome is measured from.',
      );
    }
    return { basis, entryPrice: s.entry.low };
  }
  fail('BASIS_UNAVAILABLE', 'Externally verified outcomes require an integration that does not exist yet.');
}

function assertExitTime(s: TradeState, exitedAt: string | undefined, now: Date): string {
  const at = exitedAt ? new Date(exitedAt) : now;
  if (Number.isNaN(at.getTime())) fail('VALIDATION', 'Exit time is not a valid date.');
  if (at.getTime() > now.getTime() + 60_000) fail('EXIT_IN_FUTURE', 'The exit time cannot be in the future.');
  if (s.activatedAt && at.getTime() < new Date(s.activatedAt).getTime()) {
    fail('EXIT_BEFORE_ENTRY', 'The exit time cannot be earlier than the activation of this trade.');
  }
  return at.toISOString();
}

/** One line of an update notice: "Stop-loss updated: 64,920 (was 64,800)". */
export function changeLine(change: { field: string; from: string | null; to: string | null }): string {
  if (change.to === null) return `${change.field} removed`;
  return change.from === null
    ? `${change.field}: ${change.to}`
    : `${change.field} updated: ${change.to} (was ${change.from})`;
}

/** A time in a correction notice. UTC, so it reads the same for every subscriber and in the audit log. */
function utcLabel(iso: string | null): string | null {
  return iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : null;
}

function movementText(basis: CalculationBasis, points: string | null): string | null {
  if (points === null) return null;
  const value = toDec(points);
  const signed = `${value.greaterThan(0) ? '+' : ''}${formatPoints(value)} pts`;
  const label = basis === 'HYPOTHETICAL_OUTCOME' ? 'signal result' : 'recorded entry';
  return `${signed} (${label})`;
}

function remainingQuantity(s: TradeState): Dec | null {
  if (!s.execution?.quantity) return null;
  return s.closures.reduce((sum, c) => sum.minus(toDec(c.quantity ?? '0')), toDec(s.execution.quantity));
}

function closureFromCommand(
  s: TradeState,
  input: {
    kind: 'PARTIAL' | 'FINAL';
    fraction: Dec;
    quantity: string | null;
    exitPrice: string;
    exitedAt: string;
    reason: CloseReason | null;
    basis: CalculationBasis;
    entryPrice: string | null;
    fees?: string;
  },
): NewClosure {
  if (input.fees !== undefined && input.quantity === null) {
    fail('FEES_WITHOUT_POSITION', 'Fees apply only to a recorded position with a quantity.');
  }
  const multiplier = input.quantity !== null ? s.spec.contractMultiplier : null;
  const result = computeClosureResult({
    direction: s.direction,
    basis: input.basis,
    entryPrice: input.entryPrice,
    exitPrice: input.exitPrice,
    fraction: canon(input.fraction),
    quantity: input.quantity,
    contractMultiplier: multiplier,
    fees: input.fees ?? null,
    pointSize: s.spec.pointSize,
  });
  const exceeds = (value: string | null, limit: Dec) =>
    value !== null && toDec(value).abs().greaterThanOrEqualTo(limit);
  if (
    exceeds(result.priceMove, MAX_MOVE) ||
    exceeds(result.points, MAX_MOVE) ||
    exceeds(result.grossPnl, MAX_MONEY) ||
    exceeds(result.netPnl, MAX_MONEY)
  ) {
    fail('RESULT_OUT_OF_RANGE', 'That result is too large to be right. Check the prices and quantity.');
  }
  return {
    ...result,
    kind: input.kind,
    fraction: canon(input.fraction),
    quantity: input.quantity,
    exitPrice: canon(input.exitPrice),
    exitedAt: input.exitedAt,
    reason: input.reason,
    basis: input.basis,
    entryPriceUsed: input.entryPrice,
    multiplierUsed: multiplier,
    fees: input.fees ?? null,
  };
}

function closeTemplate(reason: CloseReason): TemplateKind {
  if (reason === 'TARGET_ACHIEVED') return 'FULL_PROFIT_BOOKED';
  if (reason === 'STOP_LOSS_HIT') return 'STOP_LOSS_HIT';
  return 'TRADE_CLOSED';
}

/**
 * Validates a command against the current state and produces the resulting events. Pure: the caller
 * persists the outcome in one transaction, guarded by the version check.
 */
export function decide(s: TradeState, command: TradeCommand, now: Date): Decision {
  if (command.expectedVersion !== s.version) {
    fail('STALE_VERSION', 'This trade changed after you opened it. Review the latest state and try again.');
  }
  if (!ACTION_FROM[command.action].includes(s.status)) {
    fail('INVALID_TRANSITION', `Cannot do that while the trade is "${STATUS_LABELS[s.status]}".`);
  }
  const at = now.toISOString();
  const comment = 'comment' in command ? command.comment || null : null;
  const events: DecidedEvent[] = [];
  let next = s;
  const closures: NewClosure[] = [];
  let execution: ExecutionState | null = null;

  const emit = (
    type: EventType,
    broadcast: boolean,
    templateKind: TemplateKind | null,
    specifics: EventPayload,
    context: TemplateContext = {},
  ) => {
    const payloadBase: EventPayload = { ...basePayload(next), comment, ...specifics };
    next = evolve(next, type, payloadBase, at);
    const payload: EventPayload = { ...payloadBase, after: snapshot(next) };
    events.push({
      type,
      broadcast,
      payload,
      templateKind,
      templateContext: { ...baseContext(next), comment, ...context },
    });
  };

  const recordExecution = (actualEntry: string, quantity: string | undefined) => {
    requirePrice(s.spec, actualEntry, 'actualEntry', 'Actual entry');
    if (quantity !== undefined && toDec(quantity).lessThanOrEqualTo(0)) {
      fail('VALIDATION', 'Quantity must be greater than zero.');
    }
    execution = {
      basis: 'ADMIN_DECLARED_EXECUTION',
      entryPrice: canon(actualEntry),
      quantity: quantity === undefined ? null : canon(quantity),
    };
    emit('EXECUTION_RECORDED', false, null, {
      activationPrice: execution.entryPrice,
      quantity: execution.quantity,
    });
  };

  switch (command.action) {
    case 'ACTIVATE': {
      if (command.quantity !== undefined && command.actualEntry === undefined) {
        fail('VALIDATION', 'A quantity needs an actual entry price.');
      }
      const givesLevels =
        command.entryPrice !== undefined || command.targets !== undefined || command.stopLoss !== undefined;
      let levels: EventPayload = {};
      if (levelsPending(s)) {
        // An upcoming trade becomes a trade here: it needs everything a full signal needs.
        if (command.entryPrice === undefined || command.stopLoss === undefined || !command.targets?.length) {
          fail('LEVELS_REQUIRED', 'Enter the final entry, at least one target and the stop-loss to activate.');
        }
        const finalEntry = canon(command.entryPrice);
        const targets = command.targets.map(canon);
        const stop = canon(command.stopLoss);
        const issues = validateSignalLevels({
          spec: s.spec,
          direction: s.direction,
          entry: singleEntry(finalEntry),
          targets,
          stopLoss: stop,
        });
        if (issues.length > 0) fail('VALIDATION', issues[0]?.message ?? 'Invalid levels', issues);
        levels = { finalEntry, activatedTargets: targets, activatedStop: stop };
      } else if (givesLevels) {
        fail('VALIDATION', 'This trade already has its levels. Use Correct to change them.');
      }
      if (command.actualEntry !== undefined) recordExecution(command.actualEntry, command.quantity);
      emit('ENTRY_ACTIVATED', true, 'ENTRY_ACTIVATED', levels);
      break;
    }
    case 'RECORD_EXECUTION': {
      if (s.closures.length > 0) {
        fail('EXECUTION_LOCKED', 'Exits were already measured from the earlier record. Correct those exits instead.');
      }
      recordExecution(command.actualEntry, command.quantity);
      break;
    }
    case 'MOVE_STOP': {
      requirePrice(s.spec, command.price, 'price', 'Stop-loss');
      const price = canon(command.price);
      if (toDec(price).equals(toDec(stopOf(s)))) fail('NO_CHANGE', 'The stop-loss is already at that price.');
      assertStopConsistent(s, price);
      if (isWorse(s.direction, toDec(price), toDec(stopOf(s))) && !command.allowWiden) {
        fail('WIDENS_RISK', 'This moves the stop further from the trade and increases risk. Confirm to continue.');
      }
      emit(
        'STOP_MOVED',
        true,
        'STOP_MOVED',
        { previousStop: stopOf(s), newStop: price, stopKind: 'MANUAL' },
        {
          previousStop: formatPrice(s.spec, stopOf(s)),
        },
      );
      break;
    }
    case 'MOVE_STOP_BREAKEVEN': {
      const entry = command.price ?? s.execution?.entryPrice ?? (s.entry.type === 'SINGLE' ? s.entry.low : undefined);
      if (entry === undefined) {
        fail('ENTRY_REQUIRED', 'This signal recommended a range and has no recorded entry. State the breakeven price.');
      }
      requirePrice(s.spec, entry, 'price', 'Breakeven price');
      const price = canon(entry);
      if (toDec(price).equals(toDec(stopOf(s)))) fail('NO_CHANGE', 'The stop-loss is already at breakeven.');
      assertStopConsistent(s, price);
      emit(
        'STOP_MOVED',
        true,
        'STOP_MOVED',
        { previousStop: stopOf(s), newStop: price, stopKind: 'BREAKEVEN' },
        {
          previousStop: formatPrice(s.spec, stopOf(s)),
        },
      );
      break;
    }
    case 'TRAIL_STOP': {
      const byPoints = command.referencePrice !== undefined || command.trailPoints !== undefined;
      if (command.price !== undefined && byPoints) {
        fail('VALIDATION', 'Give either the new stop-loss, or a reference price and a distance. Not both.');
      }
      let stop: Dec;
      let reference: Dec | null = null;
      if (command.price !== undefined) {
        requirePrice(s.spec, command.price, 'price', 'New stop-loss');
        stop = toDec(command.price);
      } else {
        if (command.referencePrice === undefined || command.trailPoints === undefined) {
          fail('VALIDATION', 'Give the new stop-loss, or a reference price and a distance in points.');
        }
        requirePrice(s.spec, command.referencePrice, 'referencePrice', 'Reference price');
        const distance = pointsToPriceDistance(s.spec, command.trailPoints);
        if (distance.lessThanOrEqualTo(0)) fail('VALIDATION', 'Trail distance must be greater than zero.');
        reference = toDec(command.referencePrice);
        stop = s.direction === 'BUY' ? reference.minus(distance) : reference.plus(distance);
        if (stop.lessThanOrEqualTo(0)) fail('VALIDATION', 'That trail distance gives a stop-loss below zero.');
        if (!isOnTick(s.spec, stop)) fail('OFF_TICK', 'That trail distance does not resolve to a valid price tick.');
      }
      if (isWorse(s.direction, stop, toDec(stopOf(s))) || stop.equals(toDec(stopOf(s)))) {
        fail(
          'TRAIL_NOT_TIGHTER',
          `A trail can only tighten the stop. The result (${formatPrice(s.spec, stop)}) does not improve on ${formatPrice(s.spec, stopOf(s))}.`,
        );
      }
      assertStopConsistent(s, canon(stop));
      // The distance can only be stated when it was given. Without it the general wording is the only honest one.
      const detailed = command.wording === 'DETAILED' && reference !== null && command.trailPoints !== undefined;
      emit(
        'STOP_MOVED',
        true,
        detailed ? 'STOP_TRAILED' : 'STOP_TRAILED_GENERAL',
        {
          previousStop: stopOf(s),
          newStop: canon(stop),
          stopKind: 'TRAIL',
          ...(command.trailPoints !== undefined ? { trailPoints: canon(command.trailPoints) } : {}),
          ...(reference !== null ? { referencePrice: canon(reference) } : {}),
        },
        {
          previousStop: formatPrice(s.spec, stopOf(s)),
          ...(detailed && reference !== null && command.trailPoints !== undefined
            ? { trail: `${formatPoints(command.trailPoints)} pts from ${formatPrice(s.spec, reference)}` }
            : {}),
        },
      );
      break;
    }
    case 'TARGET_HIT': {
      const target = s.targets.find((t) => t.index === command.targetIndex);
      if (!target) fail('TARGET_NOT_FOUND', `Trade ${s.ref} has no target ${command.targetIndex}.`);
      if (target.status === 'HIT') fail('NO_CHANGE', `Target ${command.targetIndex} is already marked as reached.`);
      emit(
        'TARGET_HIT',
        true,
        'TARGET_HIT',
        { targetIndex: target.index, targetPrice: target.price },
        {
          targetIndex: String(target.index),
          targetPrice: formatPrice(s.spec, target.price),
        },
      );
      break;
    }
    case 'MODIFY_TARGETS': {
      const prices = command.targets.map(canon);
      prices.forEach((p, i) => requirePrice(s.spec, p, `targets.${i}`, `Target ${i + 1}`));
      assertTargetOrder(s, prices);
      emit('TARGETS_MODIFIED', true, 'TARGETS_MODIFIED', {
        previousTargets: s.targets.filter((t) => t.status === 'OPEN').map((t) => t.price),
        newTargets: prices,
      });
      break;
    }
    case 'BOOK_PARTIAL': {
      requirePrice(s.spec, command.exitPrice, 'exitPrice', 'Exit price');
      const outcome = resolveOutcome(s, command.basis, command.hypotheticalEntry);
      let fraction: Dec;
      let quantity: string | null = null;
      if (command.quantity !== undefined) {
        if (outcome.basis !== 'ADMIN_DECLARED_EXECUTION' || !s.execution?.quantity) {
          fail('QUANTITY_UNAVAILABLE', 'A partial quantity needs a declared execution that has a quantity.');
        }
        const remaining = remainingQuantity(s) as Dec;
        const requested = toDec(command.quantity);
        if (requested.lessThanOrEqualTo(0)) fail('VALIDATION', 'Quantity must be greater than zero.');
        if (requested.greaterThan(remaining)) {
          fail('EXCEEDS_POSITION', `Only ${canon(remaining)} ${s.spec.unitLabel} remain open.`);
        }
        if (requested.equals(remaining)) {
          fail('USE_CLOSE', 'That closes everything still open. Use "Close trade" so a final reason is recorded.');
        }
        quantity = canon(requested);
        fraction = requested.dividedBy(toDec(s.execution.quantity)).toDecimalPlaces(FRACTION_DECIMALS);
      } else if (command.percent !== undefined) {
        fraction = toDec(command.percent).dividedBy(100);
        if (fraction.lessThanOrEqualTo(0)) fail('VALIDATION', 'The portion must be greater than zero.');
        if (s.execution?.quantity && outcome.basis === 'ADMIN_DECLARED_EXECUTION') {
          quantity = canon(toDec(s.execution.quantity).times(fraction).toDecimalPlaces(QUANTITY_DECIMALS));
        }
      } else {
        fail('VALIDATION', 'State the portion closed, as a percentage or a quantity.');
      }
      const remainingFraction = new Dec(1).minus(toDec(s.closedFraction));
      if (fraction.greaterThan(remainingFraction)) {
        fail('EXCEEDS_POSITION', `Only ${fractionLabel(canon(remainingFraction))} of the position remains open.`);
      }
      if (fraction.equals(remainingFraction)) {
        fail('USE_CLOSE', 'That closes everything still open. Use "Close trade" so a final reason is recorded.');
      }
      const exitedAt = assertExitTime(s, command.exitedAt, now);
      const closure = closureFromCommand(s, {
        kind: 'PARTIAL',
        fraction,
        quantity,
        exitPrice: command.exitPrice,
        exitedAt,
        reason: null,
        basis: outcome.basis,
        entryPrice: outcome.entryPrice,
        fees: command.fees,
      });
      closures.push(closure);
      const after = remainingFraction.minus(fraction);
      emit(
        'PARTIAL_BOOKED',
        true,
        'PARTIAL_BOOKED',
        {
          exitPrice: closure.exitPrice,
          exitedAt,
          fraction: closure.fraction,
          remainingFraction: canon(after),
          basis: outcome.basis,
          movementPoints: closure.points,
        },
        {
          exit: formatPrice(s.spec, closure.exitPrice),
          portion: fractionLabel(closure.fraction),
          remaining: fractionLabel(canon(after)),
          movement: movementText(outcome.basis, closure.points),
        },
      );
      break;
    }
    case 'CLOSE': {
      requirePrice(s.spec, command.exitPrice, 'exitPrice', 'Exit price');
      const outcome = resolveOutcome(s, command.basis, command.hypotheticalEntry);
      const fraction = new Dec(1).minus(toDec(s.closedFraction));
      const quantity =
        outcome.basis === 'ADMIN_DECLARED_EXECUTION' && s.execution?.quantity
          ? canon(remainingQuantity(s) as Dec)
          : null;
      const exitedAt = assertExitTime(s, command.exitedAt, now);
      const closure = closureFromCommand(s, {
        kind: 'FINAL',
        fraction,
        quantity,
        exitPrice: command.exitPrice,
        exitedAt,
        reason: command.reason,
        basis: outcome.basis,
        entryPrice: outcome.entryPrice,
        fees: command.fees,
      });
      closures.push(closure);
      if (
        command.reason === 'TARGET_ACHIEVED' &&
        closure.priceMove !== null &&
        toDec(closure.priceMove).lessThanOrEqualTo(0)
      ) {
        fail(
          'REASON_CONTRADICTS_EXIT',
          '"Target achieved" does not match an exit with no favourable move from the entry.',
        );
      }
      emit(
        'TRADE_CLOSED',
        true,
        closeTemplate(command.reason),
        {
          exitPrice: closure.exitPrice,
          exitedAt,
          fraction: closure.fraction,
          remainingFraction: '0',
          reason: command.reason,
          basis: outcome.basis,
          movementPoints: closure.points,
        },
        {
          exit: formatPrice(s.spec, closure.exitPrice),
          reason: CLOSE_REASON_LABELS[command.reason],
          movement: movementText(outcome.basis, closure.points),
        },
      );
      break;
    }
    case 'URGENT':
      emit(
        'URGENT_INSTRUCTION',
        true,
        'URGENT_INSTRUCTION',
        { message: command.message, priority: 'PRIORITY' },
        {
          message: command.message,
        },
      );
      break;
    case 'CANCEL':
      if (!canTransition(s.status, 'CANCELLED'))
        fail('INVALID_TRANSITION', 'Only a signal awaiting entry can be cancelled.');
      emit('TRADE_CANCELLED', true, 'TRADE_CANCELLED', {});
      break;
    case 'EXPIRE':
      if (!canTransition(s.status, 'EXPIRED')) fail('INVALID_TRANSITION', 'Only a signal awaiting entry can expire.');
      emit('ENTRY_EXPIRED', true, 'ENTRY_EXPIRED', {});
      break;
    case 'CORRECT': {
      const changes: NonNullable<EventPayload['changes']> = [];
      const specifics: EventPayload = { correctionReason: command.reason };
      let probe: TradeState = s;
      if (
        levelsPending(s) &&
        (command.stopLoss !== undefined || command.targets !== undefined || command.targetPrices !== undefined)
      ) {
        fail('LEVELS_PENDING', 'Targets and the stop-loss are set when this trade is activated.');
      }

      // The published levels. Correctable at any stage; the original publication stays in the history.
      if (command.entryLow !== undefined || command.entryHigh !== undefined) {
        const low = canon(command.entryLow ?? s.entry.low);
        const high = canon(command.entryHigh ?? (s.entry.type === 'SINGLE' ? low : s.entry.high));
        if (low !== s.entry.low || high !== s.entry.high) {
          changes.push({
            field: 'Entry',
            from: entryLabel(s.spec, s.entry),
            to: entryLabel(s.spec, { type: s.entry.type, low, high }),
          });
          specifics.correctedEntry = { low, high };
          probe = { ...probe, entry: { type: s.entry.type, low, high } };
        }
      }
      if (command.stopLoss !== undefined && canon(command.stopLoss) !== s.stopLoss) {
        const value = canon(command.stopLoss);
        changes.push({ field: 'Stop-loss', from: formatPrice(s.spec, stopOf(s)), to: formatPrice(s.spec, value) });
        specifics.correctedStop = value;
        probe = { ...probe, stopLoss: value };
      }
      if (command.targets !== undefined && command.targetPrices !== undefined) {
        fail('VALIDATION', 'Correct targets one way at a time: by number, or by replacing those not yet reached.');
      }
      let nextTargets: TargetState[] = s.targets;
      if (command.targets !== undefined) {
        const prices = command.targets.map(canon);
        const hit = s.targets.filter((t) => t.status === 'HIT');
        const open = s.targets.filter((t) => t.status === 'OPEN').map((t) => t.price);
        if (prices.join() !== open.join()) {
          changes.push({
            field: 'Targets',
            from: open.map((p) => formatPrice(s.spec, p)).join(', '),
            to: prices.map((p) => formatPrice(s.spec, p)).join(', '),
          });
          specifics.correctedTargets = prices;
          nextTargets = [
            ...hit,
            ...prices.map((price, i) => ({
              index: hit.length + i + 1,
              price,
              originalPrice: null,
              status: 'OPEN' as const,
              hitAt: null,
            })),
          ];
        }
      }
      if (command.targetPrices !== undefined) {
        const updated = s.targets.map((t) => ({ ...t }));
        const seen = new Set<number>();
        for (const { index, price } of command.targetPrices) {
          if (seen.has(index)) fail('VALIDATION', `Target ${index} is listed twice.`);
          seen.add(index);
          const target = updated.find((t) => t.index === index);
          if (!target) fail('TARGET_NOT_FOUND', `This trade has no target ${index}.`);
          const value = canon(price);
          if (value === target.price) continue;
          changes.push({
            field: `Target ${index}${target.status === 'HIT' ? ' (reached)' : ''}`,
            from: formatPrice(s.spec, target.price),
            to: formatPrice(s.spec, value),
          });
          target.price = value;
        }
        if (updated.some((t, i) => t.price !== s.targets[i]?.price)) {
          specifics.correctedTargetPrices = updated.map((t) => t.price);
          nextTargets = updated;
        }
      }
      if (
        specifics.correctedEntry ||
        specifics.correctedStop ||
        specifics.correctedTargets ||
        specifics.correctedTargetPrices
      ) {
        const issues = validateEntryAndTargets({
          spec: s.spec,
          direction: s.direction,
          entry: probe.entry,
          targets: nextTargets.map((t) => t.price),
        }).filter((issue) => !(levelsPending(probe) && issue.field === 'targets' && issue.code === 'REQUIRED'));
        if (issues.length > 0) fail('VALIDATION', issues[0]?.message ?? 'Invalid correction', issues);
        if (probe.stopLoss !== null) {
          requirePrice(s.spec, probe.stopLoss, 'stopLoss', 'Stop-loss');
          assertStopConsistent({ ...probe, targets: nextTargets }, probe.stopLoss);
        }
      }

      // When the trade became active.
      let activatedAt = s.activatedAt;
      if (command.activatedAt !== undefined) {
        if (!s.activatedAt) fail('NOT_ACTIVATED', 'This trade never became active, so it has no activation time.');
        const when = new Date(command.activatedAt);
        if (Number.isNaN(when.getTime())) fail('VALIDATION', 'Activation time is not a valid date.');
        if (when.getTime() > now.getTime() + 60_000) {
          fail('ACTIVATION_IN_FUTURE', 'The activation time cannot be in the future.');
        }
        if (s.publishedAt && when.getTime() < new Date(s.publishedAt).getTime()) {
          fail('ACTIVATION_BEFORE_PUBLICATION', 'The activation time cannot be earlier than the signal was published.');
        }
        const iso = when.toISOString();
        if (iso !== s.activatedAt) {
          changes.push({ field: 'Activated', from: utcLabel(s.activatedAt), to: utcLabel(iso) });
          specifics.correctedActivatedAt = iso;
          activatedAt = iso;
        }
      }

      // The entry actually obtained. Every exit is then measured from it, as declared by the administrator.
      let declaredEntry: string | null = null;
      if (command.actualEntry !== undefined) {
        if (!s.activatedAt)
          fail('NOT_ACTIVATED', 'An actual entry can be recorded only for a trade that became active.');
        requirePrice(s.spec, command.actualEntry, 'actualEntry', 'Actual entry');
        const value = canon(command.actualEntry);
        if (value !== s.execution?.entryPrice) {
          changes.push({
            field: 'Actual entry',
            from: s.execution ? formatPrice(s.spec, s.execution.entryPrice) : null,
            to: formatPrice(s.spec, value),
          });
          declaredEntry = value;
        }
      }

      // Exit records. A changed exit is superseded by a recalculated one; the original stays on file.
      const exitFields =
        command.exitPrice !== undefined ||
        command.fees !== undefined ||
        command.exitedAt !== undefined ||
        command.closeReason !== undefined;
      if (command.closureId !== undefined) {
        if (!s.closures.some((c) => c.id === command.closureId)) {
          fail('CLOSURE_NOT_FOUND', 'That exit record does not belong to this trade.');
        }
        if (!exitFields) fail('NO_CHANGE', 'State what to correct on this exit: its price, time, fees or reason.');
        specifics.correctedClosureId = command.closureId;
      } else if (exitFields) {
        fail('VALIDATION', 'Select which exit record is being corrected.');
      }
      for (const original of s.closures) {
        const editing = original.id === command.closureId;
        let { exitPrice, fees, exitedAt, reason, basis, entryPriceUsed: entryPrice } = original;
        if (editing) {
          if (command.exitPrice !== undefined) {
            requirePrice(s.spec, command.exitPrice, 'exitPrice', 'Exit price');
            exitPrice = canon(command.exitPrice);
          }
          if (command.fees !== undefined) fees = command.fees === null ? null : canon(command.fees);
          if (command.exitedAt !== undefined) {
            const when = new Date(command.exitedAt);
            if (Number.isNaN(when.getTime())) fail('VALIDATION', 'Exit time is not a valid date.');
            if (when.getTime() > now.getTime() + 60_000)
              fail('EXIT_IN_FUTURE', 'The exit time cannot be in the future.');
            exitedAt = when.toISOString();
          }
          if (command.closeReason !== undefined) {
            if (original.kind !== 'FINAL') fail('VALIDATION', 'Only the final exit has a close reason.');
            reason = command.closeReason;
          }
        }
        if (declaredEntry !== null) {
          basis = 'ADMIN_DECLARED_EXECUTION';
          entryPrice = declaredEntry;
        } else if (specifics.correctedEntry && basis === 'HYPOTHETICAL_OUTCOME') {
          // A hypothetical outcome follows the recommendation it was measured from.
          if (probe.entry.type === 'SINGLE') {
            entryPrice = probe.entry.low;
          } else if (
            entryPrice !== null &&
            (toDec(entryPrice).lessThan(toDec(probe.entry.low)) ||
              toDec(entryPrice).greaterThan(toDec(probe.entry.high)))
          ) {
            fail(
              'HYPOTHETICAL_OUTSIDE_RANGE',
              `An exit was measured from ${formatPrice(s.spec, entryPrice)}, which is outside the corrected entry. Record the actual entry as well.`,
            );
          }
        }
        if (activatedAt && new Date(exitedAt).getTime() < new Date(activatedAt).getTime()) {
          fail('EXIT_BEFORE_ENTRY', 'An exit cannot be earlier than the activation of this trade.');
        }
        if (
          exitPrice === original.exitPrice &&
          fees === original.fees &&
          exitedAt === original.exitedAt &&
          reason === original.reason &&
          basis === original.basis &&
          entryPrice === original.entryPriceUsed
        ) {
          continue;
        }
        const which =
          s.closures.length > 1
            ? ` (${original.kind === 'FINAL' ? 'final' : 'partial'} exit at ${formatPrice(s.spec, original.exitPrice)})`
            : '';
        if (exitPrice !== original.exitPrice) {
          changes.push({
            field: `Exit price${which}`,
            from: formatPrice(s.spec, original.exitPrice),
            to: formatPrice(s.spec, exitPrice),
          });
        }
        if (exitedAt !== original.exitedAt) {
          changes.push({ field: `Exit time${which}`, from: utcLabel(original.exitedAt), to: utcLabel(exitedAt) });
        }
        if (reason !== original.reason) {
          changes.push({
            field: 'Close reason',
            from: original.reason ? CLOSE_REASON_LABELS[original.reason] : null,
            to: reason ? CLOSE_REASON_LABELS[reason] : null,
          });
        }
        if (fees !== original.fees) changes.push({ field: `Fees${which}`, from: original.fees, to: fees });
        const fresh = closureFromCommand(s, {
          kind: original.kind,
          fraction: toDec(original.fraction),
          quantity: original.quantity,
          exitPrice,
          exitedAt,
          reason,
          basis,
          entryPrice,
          fees: fees ?? undefined,
        });
        if (fresh.points !== original.points) {
          changes.push({
            field: `Result${which}`,
            from: movementText(original.basis, original.points),
            to: movementText(basis, fresh.points),
          });
        }
        closures.push({ ...fresh, supersedesClosureId: original.id });
      }

      if (changes.length === 0) fail('NO_CHANGE', 'Nothing in this correction differs from the current record.');
      if (declaredEntry !== null) {
        recordExecution(declaredEntry, s.execution?.quantity ?? undefined);
        if (s.closures.length > 0) specifics.correctedBasis = 'ADMIN_DECLARED_EXECUTION';
      }
      specifics.changes = changes;
      // Subscribers see what changed, plainly. The reason and who made it stay in the payload and the audit log.
      emit('CORRECTION', true, 'CORRECTION', specifics, {
        reason: command.reason,
        changes: changes.map(changeLine).join('\n'),
      });
      break;
    }
  }

  return { events, next, closures, execution };
}
