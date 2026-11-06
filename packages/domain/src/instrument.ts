import { canon, decimalPlaces, Dec, type DecimalString, groupThousands, toDec } from './decimal.js';

/**
 * Everything arithmetic needs to know about an instrument. Copied onto a trade when it is
 * published, so that editing an instrument later never rewrites historical calculations.
 */
export interface InstrumentSpec {
  symbol: string;
  displayName: string;
  assetClass: string;
  quoteCurrency: string;
  pricePrecision: number;
  tickSize: DecimalString;
  /** Price distance represented by one "point" on this instrument. */
  pointSize: DecimalString;
  defaultTargetPoints: DecimalString;
  defaultStopPoints: DecimalString;
  /** Optional default offsets for targets 2 and 3, measured like target 1. */
  defaultTarget2Points: DecimalString | null;
  defaultTarget3Points: DecimalString | null;
  /** Monetary value of a one-unit price move per unit of quantity. Null means monetary P&L is unavailable. */
  contractMultiplier: DecimalString | null;
  unitLabel: string;
}

export interface Issue {
  field: string;
  code: string;
  message: string;
}

export function isOnTick(spec: InstrumentSpec, value: DecimalString | Dec): boolean {
  return toDec(value).mod(toDec(spec.tickSize)).isZero();
}

export function pointsToPriceDistance(spec: InstrumentSpec, points: DecimalString): Dec {
  return toDec(points).times(toDec(spec.pointSize));
}

export function priceDistanceToPoints(spec: InstrumentSpec, distance: DecimalString | Dec): Dec {
  return toDec(distance).dividedBy(toDec(spec.pointSize));
}

export function formatPrice(spec: Pick<InstrumentSpec, 'pricePrecision'>, value: DecimalString | Dec): string {
  return groupThousands(toDec(value).toFixed(spec.pricePrecision, Dec.ROUND_HALF_EVEN));
}

/** Points are shown with as many decimals as they actually have, capped for legibility. */
export function formatPoints(value: DecimalString | Dec): string {
  const d = toDec(value);
  return groupThousands(d.decimalPlaces() > 2 ? d.toFixed(2, Dec.ROUND_HALF_EVEN) : d.toFixed());
}

export function validatePrice(spec: InstrumentSpec, value: DecimalString, field: string, label: string): Issue[] {
  let parsed: Dec;
  try {
    parsed = toDec(value);
  } catch {
    return [{ field, code: 'INVALID_NUMBER', message: `${label} must be a plain number.` }];
  }
  if (!parsed.isFinite() || parsed.lessThanOrEqualTo(0)) {
    return [{ field, code: 'NOT_POSITIVE', message: `${label} must be greater than zero.` }];
  }
  if (decimalPlaces(value) > spec.pricePrecision) {
    return [
      {
        field,
        code: 'TOO_PRECISE',
        message: `${label} allows at most ${spec.pricePrecision} decimal places on ${spec.symbol}.`,
      },
    ];
  }
  if (!isOnTick(spec, parsed)) {
    return [
      {
        field,
        code: 'OFF_TICK',
        message: `${label} must be a multiple of the ${canon(spec.tickSize)} tick size on ${spec.symbol}.`,
      },
    ];
  }
  return [];
}

/** Validates the configuration itself, used when an administrator edits an instrument. */
export function validateInstrumentSpec(spec: InstrumentSpec): Issue[] {
  const issues: Issue[] = [];
  const positive = (field: keyof InstrumentSpec, label: string, value: string | null) => {
    if (value === null) return;
    try {
      if (toDec(value).lessThanOrEqualTo(0)) throw new RangeError();
    } catch {
      issues.push({ field, code: 'NOT_POSITIVE', message: `${label} must be greater than zero.` });
    }
  };
  positive('tickSize', 'Tick size', spec.tickSize);
  positive('pointSize', 'Point size', spec.pointSize);
  positive('defaultTargetPoints', 'Default target offset', spec.defaultTargetPoints);
  positive('defaultStopPoints', 'Default stop-loss offset', spec.defaultStopPoints);
  positive('defaultTarget2Points', 'Target 2 offset', spec.defaultTarget2Points);
  positive('defaultTarget3Points', 'Target 3 offset', spec.defaultTarget3Points);
  positive('contractMultiplier', 'Contract multiplier', spec.contractMultiplier);
  if (!Number.isInteger(spec.pricePrecision) || spec.pricePrecision < 0 || spec.pricePrecision > 8) {
    issues.push({ field: 'pricePrecision', code: 'INVALID', message: 'Price precision must be 0 to 8 decimals.' });
  }
  if (issues.length > 0) return issues;

  if (decimalPlaces(spec.tickSize) > spec.pricePrecision) {
    issues.push({ field: 'tickSize', code: 'TOO_PRECISE', message: 'Tick size is finer than the price precision.' });
  }
  const offsets: [keyof InstrumentSpec, string, string | null][] = [
    ['defaultTargetPoints', 'Default target offset', spec.defaultTargetPoints],
    ['defaultTarget2Points', 'Target 2 offset', spec.defaultTarget2Points],
    ['defaultTarget3Points', 'Target 3 offset', spec.defaultTarget3Points],
    ['defaultStopPoints', 'Default stop-loss offset', spec.defaultStopPoints],
  ];
  for (const [field, label, value] of offsets) {
    if (value !== null && !isOnTick(spec, pointsToPriceDistance(spec, value))) {
      issues.push({ field, code: 'OFF_TICK', message: `${label} does not resolve to a whole number of ticks.` });
    }
  }
  const t1 = toDec(spec.defaultTargetPoints);
  if (spec.defaultTarget2Points && toDec(spec.defaultTarget2Points).lessThanOrEqualTo(t1)) {
    issues.push({ field: 'defaultTarget2Points', code: 'ORDER', message: 'Target 2 offset must exceed target 1.' });
  }
  if (
    spec.defaultTarget3Points &&
    (!spec.defaultTarget2Points || toDec(spec.defaultTarget3Points).lessThanOrEqualTo(toDec(spec.defaultTarget2Points)))
  ) {
    issues.push({ field: 'defaultTarget3Points', code: 'ORDER', message: 'Target 3 offset must exceed target 2.' });
  }
  return issues;
}
