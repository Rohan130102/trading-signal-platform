import { describe, expect, it } from 'vitest';
import {
  type AdminTradeDetail,
  composeSignal,
  defaultExitBasis,
  defaultSignalTemplateKind,
  type InstrumentSpec,
  isSignalReady,
  isTemplateForDirection,
  previewExit,
  previewSignalEvent,
  remainingFraction,
  trailStopPrice,
} from '../src/index.js';

const gold: InstrumentSpec = {
  symbol: 'XAU/USD',
  displayName: 'Gold',
  assetClass: 'COMMODITY',
  quoteCurrency: 'USD',
  pricePrecision: 2,
  tickSize: '0.01',
  pointSize: '1',
  defaultTargetPoints: '300',
  defaultStopPoints: '150',
  defaultTarget2Points: null,
  defaultTarget3Points: null,
  contractMultiplier: '100',
  unitLabel: 'oz',
};

const form = {
  direction: 'BUY' as const,
  entryType: 'SINGLE' as const,
  entryLow: '3300',
  entryHigh: '',
  custom: false,
  targets: ['', '', ''],
  stopLoss: '',
};

const trade = (overrides: Partial<AdminTradeDetail> = {}) =>
  ({
    direction: 'BUY',
    entryType: 'SINGLE',
    entryLow: '3300',
    entryHigh: '3300',
    closedFraction: '0',
    pointSize: '1',
    contractMultiplier: '100',
    closures: [],
    execution: null,
    ...overrides,
  }) as unknown as AdminTradeDetail;

describe('composing a signal', () => {
  it('calculates BUY and SELL levels from the instrument settings', () => {
    const buy = composeSignal(form, gold);
    expect(buy.targets).toEqual(['3600']);
    expect(buy.stopLoss).toBe('3150');
    expect(isSignalReady(buy)).toBe(true);
    const sell = composeSignal({ ...form, direction: 'SELL' }, gold);
    expect(sell.targets).toEqual(['3000']);
    expect(sell.stopLoss).toBe('3450');
  });

  it('uses a range conservatively', () => {
    const range = composeSignal({ ...form, entryType: 'RANGE', entryLow: '3300', entryHigh: '3310' }, gold);
    expect(range.targets).toEqual(['3610']);
    expect(range.stopLoss).toBe('3150');
  });

  it('holds nothing back while incomplete, and is not ready', () => {
    expect(isSignalReady(composeSignal({ ...form, entryLow: '' }, gold))).toBe(false);
    expect(isSignalReady(composeSignal({ ...form, direction: null }, gold))).toBe(false);
    expect(isSignalReady(composeSignal(form, undefined))).toBe(false);
  });

  it('rejects text that is not a number', () => {
    const bad = composeSignal({ ...form, entryLow: '33oo' }, gold);
    expect(bad.issues[0]?.code).toBe('INVALID_NUMBER');
    expect(isSignalReady(bad)).toBe(false);
  });

  it('rejects custom levels on the wrong side of the entry', () => {
    const bad = composeSignal({ ...form, custom: true, targets: ['3200', '', ''], stopLoss: '3400' }, gold);
    expect(bad.issues.length).toBeGreaterThan(0);
    expect(isSignalReady(bad)).toBe(false);
  });

  it('accepts sensible custom levels', () => {
    const custom = composeSignal({ ...form, custom: true, targets: ['3400', '3500', ''], stopLoss: '3250.50' }, gold);
    expect(custom.targets).toEqual(['3400', '3500']);
    expect(custom.stopLoss).toBe('3250.5');
    expect(isSignalReady(custom)).toBe(true);
  });

  it('never drifts because of floating point', () => {
    const fx = {
      ...gold,
      pricePrecision: 5,
      tickSize: '0.00001',
      pointSize: '0.0001',
      defaultTargetPoints: '30',
      defaultStopPoints: '15',
    };
    const composed = composeSignal({ ...form, entryLow: '1.10000' }, fx);
    expect(composed.targets).toEqual(['1.103']);
    expect(composed.stopLoss).toBe('1.0985');
  });
});

describe('template choice', () => {
  it('picks the standard wording for the direction, unless priority', () => {
    expect(defaultSignalTemplateKind('BUY', 'NORMAL')).toBe('BUY_STANDARD');
    expect(defaultSignalTemplateKind('SELL', 'NORMAL')).toBe('SELL_STANDARD');
    expect(defaultSignalTemplateKind('SELL', 'PRIORITY')).toBe('PRIORITY_SIGNAL');
    expect(isTemplateForDirection('SELL_STANDARD', 'BUY')).toBe(false);
    expect(isTemplateForDirection('BUY_STANDARD', 'BUY')).toBe(true);
    expect(isTemplateForDirection('PRIORITY_SIGNAL', 'SELL')).toBe(true);
  });
});

describe('preview of what subscribers get', () => {
  it('fills the wording and the card from the same numbers', () => {
    const composed = composeSignal(form, gold);
    const event = previewSignalEvent({
      spec: gold,
      direction: 'BUY',
      composed,
      priority: 'NORMAL',
      commentary: ' watch the open ',
      template: { title: 'BUY {{instrument}}', body: 'Entry {{entry}} stop {{stop}} target {{target1}}' },
    });
    expect(event?.title).toBe('BUY XAU/USD');
    expect(event?.body).toBe('Entry 3,300.00 stop 3,150.00 target 3,600.00');
    expect(event?.payload.comment).toBe('watch the open');
    expect(event?.payload.after?.targets[0]?.price).toBe('3600');
    expect(event?.tone).toBe('BUY');
  });

  it('gives nothing while the signal has problems', () => {
    const composed = composeSignal({ ...form, custom: true, targets: ['3200', '', ''], stopLoss: '3400' }, gold);
    expect(
      previewSignalEvent({
        spec: gold,
        direction: 'BUY',
        composed,
        priority: 'NORMAL',
        commentary: '',
        template: undefined,
      }),
    ).toBeNull();
  });
});

describe('trail preview', () => {
  it('measures from the given price in the right direction', () => {
    expect(trailStopPrice(gold, 'BUY', '3400', '50')?.toFixed()).toBe('3350');
    expect(trailStopPrice(gold, 'SELL', '3400', '50')?.toFixed()).toBe('3450');
    expect(trailStopPrice(gold, 'BUY', '', '50')).toBeNull();
    expect(trailStopPrice(gold, 'BUY', '3400', 'abc')).toBeNull();
  });
});

describe('exit preview', () => {
  const base = {
    basis: 'HYPOTHETICAL_OUTCOME' as const,
    hypotheticalEntry: '3300',
    fees: '',
    final: true,
    percent: '50',
  };

  it('starts on the honest basis', () => {
    expect(defaultExitBasis(trade())).toBe('HYPOTHETICAL_OUTCOME');
    expect(defaultExitBasis(trade({ entryType: 'RANGE' }))).toBe('NONE');
    expect(defaultExitBasis(trade({ execution: { basis: 'x', entryPrice: '3300', quantity: null } }))).toBe(
      'ADMIN_DECLARED_EXECUTION',
    );
    expect(
      defaultExitBasis(
        trade({ closures: [{ basis: 'NONE', superseded: false }] as unknown as AdminTradeDetail['closures'] }),
      ),
    ).toBe('NONE');
  });

  it('a hypothetical exit measures a move and invents no money', () => {
    const out = previewExit({ ...base, trade: trade(), exitPrice: '3450' });
    expect(out?.result.points).toBe('150');
    expect(out?.result.netPnl).toBeNull();
    expect(out?.quantity).toBeNull();
  });

  it('a declared exit with a position gives money, net of fees, on the share being closed', () => {
    const declared = trade({ closedFraction: '0.5', execution: { basis: 'x', entryPrice: '3300', quantity: '2' } });
    const out = previewExit({
      ...base,
      basis: 'ADMIN_DECLARED_EXECUTION',
      trade: declared,
      exitPrice: '3400',
      fees: '10',
    });
    expect(out?.quantity).toBe('1');
    expect(out?.result.netPnl).toBe('9990');
    expect(remainingFraction(declared).toFixed()).toBe('0.5');
  });

  it('a partial exit uses the percentage asked for', () => {
    const declared = trade({ execution: { basis: 'x', entryPrice: '3300', quantity: '2' } });
    const out = previewExit({
      ...base,
      basis: 'ADMIN_DECLARED_EXECUTION',
      trade: declared,
      exitPrice: '3400',
      final: false,
      percent: '25',
    });
    expect(out?.quantity).toBe('0.5');
    expect(out?.result.netPnl).toBe('5000');
  });

  it('with no exit price there is nothing to preview', () => {
    expect(previewExit({ ...base, trade: trade(), exitPrice: '' })).toBeNull();
  });

  it('a sell moves the other way', () => {
    const out = previewExit({ ...base, trade: trade({ direction: 'SELL' }), exitPrice: '3250' });
    expect(out?.result.points).toBe('50');
  });
});
