import { canon, Dec, type DecimalString, toDec } from './decimal.js';
import type { Direction } from './signal.js';

/** Bumped whenever the formulas change. Stored on each closure beside its source inputs. */
export const METHODOLOGY_VERSION = 'pnl-v1';

/** Matches the NUMERIC scale of the columns, so what is computed is exactly what is stored. */
export const RESULT_DECIMALS = 8;
const fix = (value: Dec): DecimalString => canon(value.toDecimalPlaces(RESULT_DECIMALS));

/**
 * What a recorded outcome is based on. `EXTERNALLY_VERIFIED` is reserved for a future integration
 * and cannot be reached through any admin action: an admin-typed exit is never "verified".
 */
export const CALCULATION_BASES = [
  'NONE',
  'HYPOTHETICAL_OUTCOME',
  'ADMIN_DECLARED_EXECUTION',
  'EXTERNALLY_VERIFIED',
] as const;
export type CalculationBasis = (typeof CALCULATION_BASES)[number];

export const BASIS_LABELS: Record<CalculationBasis, string> = {
  NONE: 'No measurable basis',
  HYPOTHETICAL_OUTCOME: 'Signal result, measured from its own entry',
  ADMIN_DECLARED_EXECUTION: 'Measured from the recorded entry, not independently verified',
  EXTERNALLY_VERIFIED: 'Externally verified execution',
};

export interface ClosureInput {
  direction: Direction;
  basis: CalculationBasis;
  /** Entry the outcome is measured from. Null when no entry can be honestly stated. */
  entryPrice: DecimalString | null;
  exitPrice: DecimalString;
  /** Portion of the position this closure covers, as a fraction in (0, 1]. */
  fraction: DecimalString;
  /** Units closed. Null unless a real position size was declared. */
  quantity: DecimalString | null;
  contractMultiplier: DecimalString | null;
  fees: DecimalString | null;
  pointSize: DecimalString;
}

export interface ClosureResult {
  /** Signed move per unit in quote currency. Positive is favourable. Null if unmeasurable. */
  priceMove: DecimalString | null;
  /** Same move expressed in instrument points. */
  points: DecimalString | null;
  /** Monetary figures exist only with a declared entry, quantity and multiplier. */
  grossPnl: DecimalString | null;
  netPnl: DecimalString | null;
  methodologyVersion: string;
}

/**
 * Long: gross = (exit - entry) x quantity x multiplier.
 * Short: gross = (entry - exit) x quantity x multiplier.
 * Net = gross - fees.
 *
 * Anything missing leaves the corresponding figure null. There is no fallback value by design:
 * an unknown position size must never turn into an invented monetary result.
 */
export function computeClosureResult(input: ClosureInput): ClosureResult {
  const base: ClosureResult = {
    priceMove: null,
    points: null,
    grossPnl: null,
    netPnl: null,
    methodologyVersion: METHODOLOGY_VERSION,
  };
  if (input.basis === 'NONE' || input.entryPrice === null) return base;

  const entry = toDec(input.entryPrice);
  const exit = toDec(input.exitPrice);
  const move = input.direction === 'BUY' ? exit.minus(entry) : entry.minus(exit);
  const result: ClosureResult = {
    ...base,
    priceMove: fix(move),
    points: fix(move.dividedBy(toDec(input.pointSize))),
  };
  const monetary =
    input.basis !== 'HYPOTHETICAL_OUTCOME' && input.quantity !== null && input.contractMultiplier !== null;
  if (!monetary) return result;

  const gross = move.times(toDec(input.quantity as string)).times(toDec(input.contractMultiplier as string));
  const fees = input.fees === null ? new Dec(0) : toDec(input.fees);
  result.grossPnl = fix(gross);
  result.netPnl = fix(gross.minus(fees));
  return result;
}

export const TRADE_OUTCOMES = ['WIN', 'LOSS', 'BREAKEVEN', 'UNRESOLVED'] as const;
export type TradeOutcome = (typeof TRADE_OUTCOMES)[number];

export interface ClosureRecord {
  fraction: DecimalString;
  exitPrice: DecimalString;
  basis: CalculationBasis;
  priceMove: DecimalString | null;
  points: DecimalString | null;
  grossPnl: DecimalString | null;
  netPnl: DecimalString | null;
  fees: DecimalString | null;
}

export interface TradeAggregate {
  basis: CalculationBasis;
  closedFraction: DecimalString;
  /** Exit price averaged by fraction closed. */
  averageExit: DecimalString | null;
  /** Fraction-weighted movement. Null if any closed portion is unmeasurable. */
  weightedPriceMove: DecimalString | null;
  weightedPoints: DecimalString | null;
  /** Null unless every closure carries a monetary figure: partial sums would mislead. */
  grossPnl: DecimalString | null;
  netPnl: DecimalString | null;
  fees: DecimalString | null;
  outcome: TradeOutcome;
}

/**
 * Combines a trade's closures. Each portion is counted once, weighted by the share of the position
 * it closed. Mixed bases (hypothetical plus declared) resolve to UNRESOLVED, not a blended figure.
 */
export function aggregateClosures(closures: ClosureRecord[], isFullyClosed: boolean): TradeAggregate {
  const closedFraction = closures.reduce((sum, c) => sum.plus(toDec(c.fraction)), new Dec(0));
  const bases = new Set(closures.map((c) => c.basis));
  const basis: CalculationBasis = bases.size === 1 ? (closures[0] as ClosureRecord).basis : 'NONE';
  const empty: TradeAggregate = {
    basis,
    closedFraction: canon(closedFraction),
    averageExit: null,
    weightedPriceMove: null,
    weightedPoints: null,
    grossPnl: null,
    netPnl: null,
    fees: null,
    outcome: 'UNRESOLVED',
  };
  if (closures.length === 0) return { ...empty, basis: 'NONE' };

  const averageExit = closures
    .reduce((sum, c) => sum.plus(toDec(c.exitPrice).times(toDec(c.fraction))), new Dec(0))
    .dividedBy(closedFraction);

  if (bases.size !== 1 || basis === 'NONE' || closures.some((c) => c.priceMove === null)) {
    return { ...empty, averageExit: fix(averageExit) };
  }

  const weighted = (pick: (c: ClosureRecord) => string | null) =>
    closures.reduce((sum, c) => sum.plus(toDec(pick(c) as string).times(toDec(c.fraction))), new Dec(0));
  const weightedMove = weighted((c) => c.priceMove);
  const weightedPoints = weighted((c) => c.points);

  const allMonetary = closures.every((c) => c.grossPnl !== null && c.netPnl !== null);
  const gross = allMonetary ? closures.reduce((sum, c) => sum.plus(toDec(c.grossPnl as string)), new Dec(0)) : null;
  const net = allMonetary ? closures.reduce((sum, c) => sum.plus(toDec(c.netPnl as string)), new Dec(0)) : null;
  const fees = closures.some((c) => c.fees !== null)
    ? closures.reduce((sum, c) => (c.fees === null ? sum : sum.plus(toDec(c.fees))), new Dec(0))
    : null;

  const deciding = net ?? weightedMove;
  const outcome: TradeOutcome = !isFullyClosed
    ? 'UNRESOLVED'
    : deciding.greaterThan(0)
      ? 'WIN'
      : deciding.lessThan(0)
        ? 'LOSS'
        : 'BREAKEVEN';

  return {
    basis,
    closedFraction: canon(closedFraction),
    averageExit: fix(averageExit),
    weightedPriceMove: fix(weightedMove),
    weightedPoints: fix(weightedPoints),
    grossPnl: gross === null ? null : canon(gross),
    netPnl: net === null ? null : canon(net),
    fees: fees === null ? null : canon(fees),
    outcome,
  };
}

export interface StatsTrade {
  /** Lifecycle state from the state machine. */
  status: string;
  aggregate: TradeAggregate | null;
  symbol: string;
}

export interface PerformanceStats {
  totalRecords: number;
  open: number;
  awaitingEntry: number;
  cancelled: number;
  expiredWithoutEntry: number;
  finalized: number;
  unresolved: number;
  wins: number;
  losses: number;
  breakevens: number;
  /** wins / (wins + losses + breakevens). Null when that denominator is zero. */
  winRate: DecimalString | null;
  winRateDenominator: number;
  averageWinPoints: DecimalString | null;
  averageLossPoints: DecimalString | null;
  netPoints: DecimalString;
  /** Monetary figures cover only trades that have them; see `monetaryTrades`. */
  monetaryTrades: number;
  grossPnl: DecimalString | null;
  netPnl: DecimalString | null;
  averageWinNet: DecimalString | null;
  averageLossNet: DecimalString | null;
}

const OPEN_STATUSES = new Set(['ACTIVE', 'PARTIALLY_CLOSED']);

/**
 * Win-rate definition (methodology pnl-v1): a trade counts once, when fully closed, and only with a
 * measurable outcome. Open, cancelled, untriggered and unresolved records are excluded from the
 * denominator but always reported beside it, so nothing silently disappears from the dataset.
 *
 * Points across different instruments are not comparable, so callers should treat `netPoints` as
 * meaningful only when filtered to a single instrument.
 */
export function computePerformanceStats(trades: StatsTrade[]): PerformanceStats {
  const stats: PerformanceStats = {
    totalRecords: trades.length,
    open: 0,
    awaitingEntry: 0,
    cancelled: 0,
    expiredWithoutEntry: 0,
    finalized: 0,
    unresolved: 0,
    wins: 0,
    losses: 0,
    breakevens: 0,
    winRate: null,
    winRateDenominator: 0,
    averageWinPoints: null,
    averageLossPoints: null,
    netPoints: '0',
    monetaryTrades: 0,
    grossPnl: null,
    netPnl: null,
    averageWinNet: null,
    averageLossNet: null,
  };
  let winPoints = new Dec(0);
  let lossPoints = new Dec(0);
  let netPoints = new Dec(0);
  let gross = new Dec(0);
  let net = new Dec(0);
  let winNet = new Dec(0);
  let lossNet = new Dec(0);
  let winMonetary = 0;
  let lossMonetary = 0;

  for (const trade of trades) {
    if (OPEN_STATUSES.has(trade.status)) stats.open += 1;
    if (trade.status === 'PUBLISHED') stats.awaitingEntry += 1;
    if (trade.status === 'CANCELLED') stats.cancelled += 1;
    if (trade.status === 'EXPIRED') stats.expiredWithoutEntry += 1;
    if (trade.status !== 'CLOSED') continue;

    stats.finalized += 1;
    const aggregate = trade.aggregate;
    if (!aggregate || aggregate.outcome === 'UNRESOLVED') {
      stats.unresolved += 1;
      continue;
    }
    const points = toDec(aggregate.weightedPoints as string);
    netPoints = netPoints.plus(points);
    if (aggregate.outcome === 'WIN') {
      stats.wins += 1;
      winPoints = winPoints.plus(points);
    } else if (aggregate.outcome === 'LOSS') {
      stats.losses += 1;
      lossPoints = lossPoints.plus(points);
    } else {
      stats.breakevens += 1;
    }
    if (aggregate.netPnl !== null && aggregate.grossPnl !== null) {
      stats.monetaryTrades += 1;
      gross = gross.plus(toDec(aggregate.grossPnl));
      net = net.plus(toDec(aggregate.netPnl));
      if (aggregate.outcome === 'WIN') {
        winNet = winNet.plus(toDec(aggregate.netPnl));
        winMonetary += 1;
      }
      if (aggregate.outcome === 'LOSS') {
        lossNet = lossNet.plus(toDec(aggregate.netPnl));
        lossMonetary += 1;
      }
    }
  }

  stats.winRateDenominator = stats.wins + stats.losses + stats.breakevens;
  if (stats.winRateDenominator > 0) {
    stats.winRate = canon(new Dec(stats.wins).dividedBy(stats.winRateDenominator).toDecimalPlaces(6));
  }
  if (stats.wins > 0) stats.averageWinPoints = canon(winPoints.dividedBy(stats.wins).toDecimalPlaces(8));
  if (stats.losses > 0) stats.averageLossPoints = canon(lossPoints.dividedBy(stats.losses).toDecimalPlaces(8));
  stats.netPoints = canon(netPoints);
  if (stats.monetaryTrades > 0) {
    stats.grossPnl = canon(gross);
    stats.netPnl = canon(net);
  }
  if (winMonetary > 0) stats.averageWinNet = canon(winNet.dividedBy(winMonetary).toDecimalPlaces(8));
  if (lossMonetary > 0) stats.averageLossNet = canon(lossNet.dividedBy(lossMonetary).toDecimalPlaces(8));
  return stats;
}
