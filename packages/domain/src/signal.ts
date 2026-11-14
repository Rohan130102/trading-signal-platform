import { canon, Dec, type DecimalString, toDec } from './decimal.js';
import {
  type InstrumentSpec,
  type Issue,
  pointsToPriceDistance,
  priceDistanceToPoints,
  validatePrice,
} from './instrument.js';

export const DIRECTIONS = ['BUY', 'SELL'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const ENTRY_TYPES = ['SINGLE', 'RANGE'] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const MAX_TARGETS = 3;

export interface EntryLevels {
  type: EntryType;
  low: DecimalString;
  high: DecimalString;
}

export function singleEntry(price: DecimalString): EntryLevels {
  return { type: 'SINGLE', low: price, high: price };
}

export function rangeEntry(low: DecimalString, high: DecimalString): EntryLevels {
  return { type: 'RANGE', low, high };
}

/**
 * Conservative range convention: the target is measured from the boundary furthest in the
 * direction of profit and the stop from the boundary furthest against it, so a fill anywhere
 * in the range still has at least the configured distance to both levels.
 */
export function targetReference(direction: Direction, entry: EntryLevels): Dec {
  return direction === 'BUY' ? toDec(entry.high) : toDec(entry.low);
}

export function stopReference(direction: Direction, entry: EntryLevels): Dec {
  return direction === 'BUY' ? toDec(entry.low) : toDec(entry.high);
}

export interface CalculatedLevels {
  targets: DecimalString[];
  stopLoss: DecimalString;
  /** One sentence per level, shown in the composer so the arithmetic is never a mystery. */
  explanation: string[];
}

export interface CalculateInput {
  spec: InstrumentSpec;
  direction: Direction;
  entry: EntryLevels;
  /** Target offsets in points. Defaults to the instrument configuration. */
  targetPoints?: DecimalString[];
  stopPoints?: DecimalString;
}

export function defaultTargetPoints(spec: InstrumentSpec): DecimalString[] {
  return [spec.defaultTargetPoints, spec.defaultTarget2Points, spec.defaultTarget3Points].filter(
    (p): p is string => p !== null,
  );
}

export function calculateLevels(input: CalculateInput): CalculatedLevels {
  const { spec, direction, entry } = input;
  const sign = direction === 'BUY' ? 1 : -1;
  const targetPoints = input.targetPoints ?? defaultTargetPoints(spec);
  const stopPoints = input.stopPoints ?? spec.defaultStopPoints;

  const tRef = targetReference(direction, entry);
  const sRef = stopReference(direction, entry);
  const boundary = (ref: Dec) =>
    entry.type === 'RANGE'
      ? `${ref.equals(toDec(entry.high)) ? 'upper' : 'lower'} entry ${canon(ref)}`
      : `entry ${canon(ref)}`;

  const targets = targetPoints.map((points) => canon(tRef.plus(pointsToPriceDistance(spec, points).times(sign))));
  const stopLoss = canon(sRef.minus(pointsToPriceDistance(spec, stopPoints).times(sign)));

  const explanation = [
    ...targetPoints.map((points, i) => {
      const op = sign > 0 ? '+' : '−';
      return `Target ${i + 1}: ${boundary(tRef)} ${op} ${canon(points)} pts (1 pt = ${canon(spec.pointSize)} ${spec.quoteCurrency}) = ${targets[i]}`;
    }),
    `Stop-loss: ${boundary(sRef)} ${sign > 0 ? '−' : '+'} ${canon(stopPoints)} pts (1 pt = ${canon(spec.pointSize)} ${spec.quoteCurrency}) = ${stopLoss}`,
  ];
  return { targets, stopLoss, explanation };
}

export interface SignalLevels {
  spec: InstrumentSpec;
  direction: Direction;
  entry: EntryLevels;
  targets: DecimalString[];
  stopLoss: DecimalString;
}

/** Entry and target geometry. Stops are checked separately because a live stop may legitimately move into profit. */
export function validateEntryAndTargets(s: Omit<SignalLevels, 'stopLoss'>): Issue[] {
  const issues: Issue[] = [
    ...validatePrice(s.spec, s.entry.low, 'entryLow', s.entry.type === 'RANGE' ? 'Lower entry' : 'Entry'),
    ...(s.entry.type === 'RANGE' ? validatePrice(s.spec, s.entry.high, 'entryHigh', 'Upper entry') : []),
  ];
  if (s.targets.length === 0) {
    issues.push({ field: 'targets', code: 'REQUIRED', message: 'At least one target is required.' });
  }
  if (s.targets.length > MAX_TARGETS) {
    issues.push({ field: 'targets', code: 'TOO_MANY', message: `At most ${MAX_TARGETS} targets are supported.` });
  }
  s.targets.forEach((t, i) => issues.push(...validatePrice(s.spec, t, `targets.${i}`, `Target ${i + 1}`)));
  // A missing target does not stop the entry itself from being checked: an upcoming trade has none yet.
  if (issues.some((issue) => issue.field !== 'targets')) return issues;

  const low = toDec(s.entry.low);
  const high = toDec(s.entry.high);
  if (low.greaterThan(high)) {
    issues.push({ field: 'entryLow', code: 'RANGE_INVERTED', message: 'Lower entry must not exceed upper entry.' });
  }
  if (s.entry.type === 'RANGE' && low.equals(high)) {
    issues.push({
      field: 'entryHigh',
      code: 'RANGE_EMPTY',
      message: 'A range needs two different prices. Use a single entry instead.',
    });
  }
  if (s.entry.type === 'SINGLE' && !low.equals(high)) {
    issues.push({ field: 'entryHigh', code: 'SINGLE_MISMATCH', message: 'A single entry has exactly one price.' });
  }
  const targets = s.targets.map(toDec);
  if (s.direction === 'BUY') {
    targets.forEach((t, i) => {
      if (!t.greaterThan(high)) {
        issues.push({
          field: `targets.${i}`,
          code: 'TARGET_SIDE',
          message: `On a BUY, target ${i + 1} must be above the entry.`,
        });
      }
      const prev = targets[i - 1];
      if (prev && !t.greaterThan(prev)) {
        issues.push({
          field: `targets.${i}`,
          code: 'TARGET_ORDER',
          message: `Target ${i + 1} must be above target ${i}.`,
        });
      }
    });
  } else {
    targets.forEach((t, i) => {
      if (!t.lessThan(low)) {
        issues.push({
          field: `targets.${i}`,
          code: 'TARGET_SIDE',
          message: `On a SELL, target ${i + 1} must be below the entry.`,
        });
      }
      const prev = targets[i - 1];
      if (prev && !t.lessThan(prev)) {
        issues.push({
          field: `targets.${i}`,
          code: 'TARGET_ORDER',
          message: `Target ${i + 1} must be below target ${i}.`,
        });
      }
    });
  }
  return issues;
}

/** Every rule a signal must satisfy before it can reach a subscriber. */
export function validateSignalLevels(s: SignalLevels): Issue[] {
  const stopIssues = validatePrice(s.spec, s.stopLoss, 'stopLoss', 'Stop-loss');
  const issues = [...validateEntryAndTargets(s), ...stopIssues];
  if (stopIssues.length > 0) return issues;
  const hasPriceProblem = issues.some((i) =>
    ['INVALID_NUMBER', 'NOT_POSITIVE', 'TOO_PRECISE', 'OFF_TICK'].includes(i.code),
  );
  if (hasPriceProblem) return issues;
  const stop = toDec(s.stopLoss);
  if (s.direction === 'BUY' && !stop.lessThan(toDec(s.entry.low))) {
    issues.push({ field: 'stopLoss', code: 'STOP_SIDE', message: 'On a BUY, the stop-loss must be below the entry.' });
  }
  if (s.direction === 'SELL' && !stop.greaterThan(toDec(s.entry.high))) {
    issues.push({ field: 'stopLoss', code: 'STOP_SIDE', message: 'On a SELL, the stop-loss must be above the entry.' });
  }
  return issues;
}

export interface RiskSummary {
  /** Fill price the figures are measured from: the least favourable price in the recommendation. */
  referenceEntry: DecimalString;
  isRange: boolean;
  stopDistance: DecimalString;
  stopPoints: DecimalString;
  targets: { index: number; distance: DecimalString; points: DecimalString; rewardToRisk: DecimalString | null }[];
}

/**
 * Plain geometry between the levels. Says nothing about likelihood: a 1:2 ratio is a distance
 * ratio, not an expected payoff.
 */
export function riskSummary(s: SignalLevels): RiskSummary {
  const reference = targetReference(s.direction, s.entry);
  const stopDistance = reference.minus(toDec(s.stopLoss)).abs();
  return {
    referenceEntry: canon(reference),
    isRange: s.entry.type === 'RANGE',
    stopDistance: canon(stopDistance),
    stopPoints: canon(priceDistanceToPoints(s.spec, stopDistance)),
    targets: s.targets.map((t, i) => {
      const distance = toDec(t).minus(reference).abs();
      return {
        index: i + 1,
        distance: canon(distance),
        points: canon(priceDistanceToPoints(s.spec, distance)),
        rewardToRisk: stopDistance.isZero() ? null : distance.dividedBy(stopDistance).toFixed(2, Dec.ROUND_HALF_EVEN),
      };
    }),
  };
}
