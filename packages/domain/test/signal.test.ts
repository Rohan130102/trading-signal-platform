import { describe, expect, it } from 'vitest';
import {
  calculateLevels,
  canon,
  formatPrice,
  groupThousands,
  isOnTick,
  rangeEntry,
  riskSummary,
  singleEntry,
  toDec,
  validateInstrumentSpec,
  validatePrice,
  validateSignalLevels,
} from '../src/index.js';
import { FICTIONAL, XAU } from './fixtures.js';

describe('default level calculation', () => {
  it('BUY single: target above, stop below', () => {
    const { targets, stopLoss } = calculateLevels({ spec: XAU, direction: 'BUY', entry: singleEntry('3300') });
    expect(targets).toEqual(['3450']);
    expect(stopLoss).toBe('3120');
  });

  it('SELL single: target below, stop above', () => {
    const { targets, stopLoss } = calculateLevels({ spec: XAU, direction: 'SELL', entry: singleEntry('3300') });
    expect(targets).toEqual(['3150']);
    expect(stopLoss).toBe('3480');
  });

  it('BUY range measures target from upper bound and stop from lower bound', () => {
    const { targets, stopLoss } = calculateLevels({ spec: XAU, direction: 'BUY', entry: rangeEntry('3290', '3300') });
    expect(targets).toEqual(['3450']);
    expect(stopLoss).toBe('3110');
  });

  it('SELL range measures target from lower bound and stop from upper bound', () => {
    const { targets, stopLoss } = calculateLevels({ spec: XAU, direction: 'SELL', entry: rangeEntry('3290', '3300') });
    expect(targets).toEqual(['3140']);
    expect(stopLoss).toBe('3480');
  });

  it('converts points through the instrument point size, not 1:1', () => {
    const { targets, stopLoss } = calculateLevels({ spec: FICTIONAL, direction: 'BUY', entry: singleEntry('1000') });
    expect(targets).toEqual(['1150']);
    expect(stopLoss).toBe('820');
  });

  it('honours custom offsets over defaults', () => {
    const { targets, stopLoss } = calculateLevels({
      spec: XAU,
      direction: 'BUY',
      entry: singleEntry('3300'),
      targetPoints: ['50', '100', '200'],
      stopPoints: '25',
    });
    expect(targets).toEqual(['3350', '3400', '3500']);
    expect(stopLoss).toBe('3275');
  });

  it('avoids binary floating point drift', () => {
    const spec = { ...XAU, pointSize: '0.1', defaultTargetPoints: '1', defaultStopPoints: '2' };
    const { targets, stopLoss } = calculateLevels({ spec, direction: 'BUY', entry: singleEntry('0.2') });
    expect(targets).toEqual(['0.3']);
    expect(toDec('0.1').plus(toDec('0.2')).toFixed()).toBe('0.3');
    expect(stopLoss).toBe('0');
  });

  it('explains the arithmetic in words', () => {
    const { explanation } = calculateLevels({ spec: XAU, direction: 'SELL', entry: rangeEntry('3290', '3300') });
    expect(explanation[0]).toContain('lower entry 3290');
    expect(explanation[0]).toContain('3140');
    expect(explanation[1]).toContain('upper entry 3300');
  });
});

describe('signal validation', () => {
  const valid = {
    spec: XAU,
    direction: 'BUY' as const,
    entry: singleEntry('3300'),
    targets: ['3450'],
    stopLoss: '3120',
  };
  const codes = (input: Parameters<typeof validateSignalLevels>[0]) => validateSignalLevels(input).map((i) => i.code);

  it('accepts a valid BUY and a valid SELL', () => {
    expect(codes(valid)).toEqual([]);
    expect(codes({ ...valid, direction: 'SELL', targets: ['3150'], stopLoss: '3480' })).toEqual([]);
  });

  it('rejects a BUY stop at or above the entry', () => {
    expect(codes({ ...valid, stopLoss: '3300' })).toContain('STOP_SIDE');
    expect(codes({ ...valid, stopLoss: '3400' })).toContain('STOP_SIDE');
  });

  it('rejects a SELL stop at or below the entry', () => {
    expect(codes({ ...valid, direction: 'SELL', targets: ['3150'], stopLoss: '3300' })).toContain('STOP_SIDE');
  });

  it('rejects a BUY target at or below the entry, and a SELL target at or above it', () => {
    expect(codes({ ...valid, targets: ['3300'] })).toContain('TARGET_SIDE');
    expect(codes({ ...valid, direction: 'SELL', targets: ['3400'], stopLoss: '3480' })).toContain('TARGET_SIDE');
  });

  it('enforces directional target ordering', () => {
    expect(codes({ ...valid, targets: ['3450', '3400'] })).toContain('TARGET_ORDER');
    expect(codes({ ...valid, targets: ['3450', '3450'] })).toContain('TARGET_ORDER');
    expect(codes({ ...valid, direction: 'SELL', targets: ['3150', '3200'], stopLoss: '3480' })).toContain(
      'TARGET_ORDER',
    );
  });

  it('rejects an inverted or empty range', () => {
    expect(codes({ ...valid, entry: rangeEntry('3310', '3300') })).toContain('RANGE_INVERTED');
    expect(codes({ ...valid, entry: rangeEntry('3300', '3300') })).toContain('RANGE_EMPTY');
  });

  it('requires targets beyond the far edge of a range', () => {
    expect(codes({ ...valid, entry: rangeEntry('3290', '3460') })).toContain('TARGET_SIDE');
  });

  it('rejects no targets and too many targets', () => {
    expect(codes({ ...valid, targets: [] })).toContain('REQUIRED');
    expect(codes({ ...valid, targets: ['3400', '3410', '3420', '3430'] })).toContain('TOO_MANY');
  });

  it('rejects zero, negative, malformed, too precise and off-tick prices', () => {
    expect(validatePrice(XAU, '0', 'p', 'P')[0]?.code).toBe('NOT_POSITIVE');
    expect(validatePrice(XAU, '-1', 'p', 'P')[0]?.code).toBe('NOT_POSITIVE');
    expect(validatePrice(XAU, 'abc', 'p', 'P')[0]?.code).toBe('INVALID_NUMBER');
    expect(validatePrice(XAU, '1e5', 'p', 'P')[0]?.code).toBe('INVALID_NUMBER');
    expect(validatePrice(XAU, '3300.123', 'p', 'P')[0]?.code).toBe('TOO_PRECISE');
    expect(validatePrice(FICTIONAL, '1000.3', 'p', 'P')[0]?.code).toBe('OFF_TICK');
    expect(validatePrice(FICTIONAL, '1000.5', 'p', 'P')).toEqual([]);
  });

  it('checks ticks with exact decimal maths', () => {
    expect(isOnTick(XAU, '3300.07')).toBe(true);
    expect(isOnTick({ ...XAU, tickSize: '0.1' }, '0.3')).toBe(true);
  });
});

describe('risk summary', () => {
  it('reports distances and ratio from the entry for a single price', () => {
    const r = riskSummary({
      spec: XAU,
      direction: 'BUY',
      entry: singleEntry('3300'),
      targets: ['3450'],
      stopLoss: '3120',
    });
    expect(r.stopDistance).toBe('180');
    expect(r.targets[0]).toMatchObject({ distance: '150', points: '150', rewardToRisk: '0.83' });
  });

  it('uses the least favourable fill for a range', () => {
    const buy = riskSummary({
      spec: XAU,
      direction: 'BUY',
      entry: rangeEntry('3290', '3300'),
      targets: ['3450'],
      stopLoss: '3110',
    });
    expect(buy.referenceEntry).toBe('3300');
    expect(buy.stopDistance).toBe('190');
    const sell = riskSummary({
      spec: XAU,
      direction: 'SELL',
      entry: rangeEntry('3290', '3300'),
      targets: ['3140'],
      stopLoss: '3480',
    });
    expect(sell.referenceEntry).toBe('3290');
    expect(sell.stopDistance).toBe('190');
    expect(sell.targets[0]?.distance).toBe('150');
  });

  it('expresses distances in the instrument points', () => {
    const r = riskSummary({
      spec: FICTIONAL,
      direction: 'BUY',
      entry: singleEntry('1000'),
      targets: ['1150'],
      stopLoss: '820',
    });
    expect(r.targets[0]?.points).toBe('15');
    expect(r.stopPoints).toBe('18');
  });
});

describe('instrument configuration', () => {
  it('accepts the seeded shape', () => {
    expect(validateInstrumentSpec(XAU)).toEqual([]);
  });

  it('rejects offsets that do not land on a tick', () => {
    const issues = validateInstrumentSpec({ ...FICTIONAL, pointSize: '0.3', tickSize: '0.5' });
    expect(issues.map((i) => i.code)).toContain('OFF_TICK');
  });

  it('rejects non-positive sizes and bad ordering', () => {
    expect(validateInstrumentSpec({ ...XAU, tickSize: '0' })[0]?.code).toBe('NOT_POSITIVE');
    const order = validateInstrumentSpec({ ...XAU, defaultTarget2Points: '100' });
    expect(order.map((i) => i.code)).toContain('ORDER');
    const skip = validateInstrumentSpec({ ...XAU, defaultTarget3Points: '500' });
    expect(skip.map((i) => i.code)).toContain('ORDER');
  });

  it('rejects a tick finer than the precision', () => {
    expect(validateInstrumentSpec({ ...XAU, pricePrecision: 1 }).map((i) => i.code)).toContain('TOO_PRECISE');
  });
});

describe('formatting', () => {
  it('formats with the instrument precision and separators', () => {
    expect(formatPrice(XAU, '3300')).toBe('3,300.00');
    expect(formatPrice({ pricePrecision: 0 }, '98765.4')).toBe('98,765');
    expect(groupThousands('-1234567.5')).toBe('-1,234,567.5');
  });

  it('canonicalises without exponent', () => {
    expect(canon('3300.5000')).toBe('3300.5');
    expect(canon(toDec('0.00000001'))).toBe('0.00000001');
  });
});
