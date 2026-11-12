import { canon, type Dec, type DecimalString, isDecimalLiteral, toDec } from './decimal.js';
import type { AdminTradeDetail, FeedEvent } from './dto.js';
import { formatPrice, type InstrumentSpec, type Issue, pointsToPriceDistance } from './instrument.js';
import { entryLabel } from './lifecycle.js';
import { type CalculationBasis, type ClosureResult, computeClosureResult } from './pnl.js';
import {
  type CalculatedLevels,
  calculateLevels,
  type Direction,
  type EntryLevels,
  type EntryType,
  rangeEntry,
  type RiskSummary,
  riskSummary,
  singleEntry,
  validateSignalLevels,
} from './signal.js';
import type { Priority } from './status.js';
import { renderTemplateText, type TemplateKind } from './templates.js';

/**
 * What an administrator sees before anything is sent. Every client uses this, so the web and the phone
 * cannot disagree about a level. The server recalculates and has the final say.
 */

export interface ComposerFields {
  direction: Direction | null;
  entryType: EntryType;
  entryLow: string;
  entryHigh: string;
  /** False uses the instrument's configured distances. */
  custom: boolean;
  targets: readonly string[];
  stopLoss: string;
}

export interface ComposedSignal {
  entry: EntryLevels | null;
  auto: CalculatedLevels | null;
  targets: string[];
  stopLoss: string;
  issues: Issue[];
  risk: RiskSummary | null;
}

const NOT_A_NUMBER = 'Enter a plain number, such as 3300.50.';

export function composeSignal(form: ComposerFields, spec: InstrumentSpec | undefined): ComposedSignal {
  const low = form.entryLow.trim();
  const high = form.entryHigh.trim();
  let entry: EntryLevels | null = null;
  const entryIssues: Issue[] = [];
  if (form.entryType === 'SINGLE' && isDecimalLiteral(low)) entry = singleEntry(canon(low));
  if (form.entryType === 'RANGE' && isDecimalLiteral(low) && isDecimalLiteral(high)) {
    entry = rangeEntry(canon(low), canon(high));
  }
  if (low && !isDecimalLiteral(low)) {
    entryIssues.push({ field: 'entryLow', code: 'INVALID_NUMBER', message: NOT_A_NUMBER });
  }
  if (form.entryType === 'RANGE' && high && !isDecimalLiteral(high)) {
    entryIssues.push({ field: 'entryHigh', code: 'INVALID_NUMBER', message: NOT_A_NUMBER });
  }
  if (!spec || !form.direction || !entry) {
    return { entry, auto: null, targets: [], stopLoss: '', issues: entryIssues, risk: null };
  }

  const auto = calculateLevels({ spec, direction: form.direction, entry });
  const targets = form.custom ? form.targets.map((t) => t.trim()).filter(Boolean) : auto.targets;
  const stopLoss = form.custom ? form.stopLoss.trim() : auto.stopLoss;
  let issues: Issue[] = [...entryIssues];
  let risk: RiskSummary | null = null;
  const wellFormed = targets.every(isDecimalLiteral) && isDecimalLiteral(stopLoss);
  if (wellFormed) {
    const levels = {
      spec,
      direction: form.direction,
      entry,
      targets: targets.map((t) => canon(t)),
      stopLoss: canon(stopLoss),
    };
    issues = [...issues, ...validateSignalLevels(levels)];
    if (issues.length === 0) risk = riskSummary(levels);
  } else {
    issues.push({ field: 'stopLoss', code: 'INVALID_NUMBER', message: 'Targets and stop-loss must be plain numbers.' });
  }
  return {
    entry,
    auto,
    targets: wellFormed ? targets.map((t) => canon(t)) : targets,
    stopLoss: wellFormed ? canon(stopLoss) : stopLoss,
    issues,
    risk,
  };
}

export function isSignalReady(composed: ComposedSignal): boolean {
  return Boolean(composed.entry && composed.issues.length === 0 && composed.targets.length > 0 && composed.stopLoss);
}

/** Which standard wording a signal gets when no template was picked. */
export function defaultSignalTemplateKind(direction: Direction | null, priority: Priority): TemplateKind {
  if (priority === 'PRIORITY') return 'PRIORITY_SIGNAL';
  return direction === 'SELL' ? 'SELL_STANDARD' : 'BUY_STANDARD';
}

export function isTemplateForDirection(kind: string, direction: Direction | null): boolean {
  return kind === 'PRIORITY_SIGNAL' || kind === (direction === 'SELL' ? 'SELL_STANDARD' : 'BUY_STANDARD');
}

/** The feed card and notification text subscribers will get, built before anything is sent. */
export function previewSignalEvent(input: {
  spec: InstrumentSpec;
  direction: Direction;
  composed: ComposedSignal;
  priority: Priority;
  commentary: string;
  template: { title: string; body: string } | undefined;
}): FeedEvent | null {
  const { spec, direction, composed, priority, template } = input;
  if (!composed.entry || composed.issues.length > 0 || composed.targets.length === 0) return null;
  const comment = input.commentary.trim() || null;
  const context = {
    ref: 'T-NEW',
    instrument: spec.symbol,
    direction,
    entry: entryLabel(spec, composed.entry),
    stop: formatPrice(spec, composed.stopLoss),
    target1: composed.targets[0] ? formatPrice(spec, composed.targets[0]) : null,
    target2: composed.targets[1] ? formatPrice(spec, composed.targets[1]) : null,
    target3: composed.targets[2] ? formatPrice(spec, composed.targets[2]) : null,
    comment,
  };
  return {
    seq: 0,
    id: 'preview',
    tradeId: null,
    tradeVersion: 1,
    type: 'SIGNAL_PUBLISHED',
    category: 'NEW_SIGNAL',
    tone: direction === 'BUY' ? 'BUY' : 'SELL',
    priority,
    title: template ? renderTemplateText(template.title, context) : '',
    body: template ? renderTemplateText(template.body, context) : '',
    tradeStatus: 'PUBLISHED',
    createdAt: new Date().toISOString(),
    payload: {
      ref: 'T-NEW',
      symbol: spec.symbol,
      direction,
      pricePrecision: spec.pricePrecision,
      entryType: composed.entry.type,
      entryLow: composed.entry.low,
      entryHigh: composed.entry.high,
      comment,
      after: {
        status: 'PUBLISHED',
        stopLoss: composed.stopLoss,
        targets: composed.targets.map((price, i) => ({ index: i + 1, price, status: 'OPEN' as const })),
        closedFraction: '0',
      },
    },
  };
}

/** The stop-loss a trail instruction would give. Null until both numbers are usable. */
export function trailStopPrice(
  spec: Pick<InstrumentSpec, 'pointSize'>,
  direction: Direction,
  referencePrice: string,
  trailPoints: string,
): Dec | null {
  const reference = referencePrice.trim();
  const points = trailPoints.trim();
  if (!isDecimalLiteral(reference) || !isDecimalLiteral(points)) return null;
  const distance = pointsToPriceDistance(spec as InstrumentSpec, points);
  return direction === 'BUY' ? toDec(reference).minus(distance) : toDec(reference).plus(distance);
}

/** The basis an exit starts on: an earlier exit on the trade fixes it, because bases cannot be mixed. */
export function defaultExitBasis(trade: AdminTradeDetail): CalculationBasis {
  return (
    trade.closures.find((c) => !c.superseded)?.basis ??
    (trade.execution ? 'ADMIN_DECLARED_EXECUTION' : trade.entryType === 'SINGLE' ? 'HYPOTHETICAL_OUTCOME' : 'NONE')
  );
}

export interface ExitPreviewInput {
  trade: AdminTradeDetail;
  basis: CalculationBasis;
  exitPrice: string;
  hypotheticalEntry: string;
  fees: string;
  /** Closes everything still open. Otherwise `percent` of the original position. */
  final: boolean;
  percent: string;
}

/** The share still open, as a fraction. */
export function remainingFraction(trade: Pick<AdminTradeDetail, 'closedFraction'>): Dec {
  return toDec('1').minus(toDec(trade.closedFraction));
}

/** Same arithmetic the server records, so what is previewed is what is written. */
export function previewExit(input: ExitPreviewInput): { result: ClosureResult; quantity: DecimalString | null } | null {
  const { trade, basis, final } = input;
  const exitPrice = input.exitPrice.trim();
  if (!isDecimalLiteral(exitPrice)) return null;
  const fraction = final
    ? remainingFraction(trade)
    : isDecimalLiteral(input.percent.trim())
      ? toDec(input.percent.trim()).dividedBy(100)
      : null;
  const quantity =
    trade.execution?.quantity && basis === 'ADMIN_DECLARED_EXECUTION' && fraction
      ? toDec(trade.execution.quantity).times(fraction).toFixed()
      : null;
  const hypothetical = input.hypotheticalEntry.trim();
  const entryPrice =
    basis === 'ADMIN_DECLARED_EXECUTION'
      ? (trade.execution?.entryPrice ?? null)
      : basis === 'HYPOTHETICAL_OUTCOME' && isDecimalLiteral(hypothetical)
        ? hypothetical
        : null;
  const fees = input.fees.trim();
  return {
    quantity,
    result: computeClosureResult({
      direction: trade.direction,
      basis,
      entryPrice,
      exitPrice,
      fraction: fraction?.toFixed() ?? '1',
      quantity,
      contractMultiplier: quantity ? trade.contractMultiplier : null,
      fees: isDecimalLiteral(fees) ? fees : null,
      pointSize: trade.pointSize,
    }),
  };
}

/**
 * The points one exit would show after a correction, for the form's preview. A newly stated actual entry
 * re-measures the exit as declared by the administrator; otherwise its own basis and entry stay. The server
 * recalculates and has the final say.
 */
export function previewCorrectedExit(input: {
  trade: Pick<AdminTradeDetail, 'direction' | 'pointSize'>;
  closure: Pick<AdminTradeDetail['closures'][number], 'basis' | 'entryPriceUsed' | 'exitPrice' | 'fraction'>;
  actualEntry: string;
  exitPrice: string;
}): DecimalString | null {
  const actualEntry = input.actualEntry.trim();
  const exitPrice = input.exitPrice.trim() || input.closure.exitPrice;
  if (!isDecimalLiteral(exitPrice) || (actualEntry !== '' && !isDecimalLiteral(actualEntry))) return null;
  return computeClosureResult({
    direction: input.trade.direction,
    basis: actualEntry ? 'ADMIN_DECLARED_EXECUTION' : input.closure.basis,
    entryPrice: actualEntry || input.closure.entryPriceUsed,
    exitPrice,
    fraction: input.closure.fraction,
    quantity: null,
    contractMultiplier: null,
    fees: null,
    pointSize: input.trade.pointSize,
  }).points;
}
