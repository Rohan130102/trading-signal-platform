import { type InstrumentSpec, type TradeState } from '../src/index.js';

export const XAU: InstrumentSpec = {
  symbol: 'XAU/USD',
  displayName: 'Gold',
  assetClass: 'COMMODITY',
  quoteCurrency: 'USD',
  pricePrecision: 2,
  tickSize: '0.01',
  pointSize: '1',
  defaultTargetPoints: '150',
  defaultStopPoints: '180',
  defaultTarget2Points: null,
  defaultTarget3Points: null,
  contractMultiplier: '1',
  unitLabel: 'oz',
};

/** Deliberately different arithmetic: one point is ten quote units and ticks are coarse. */
export const FICTIONAL: InstrumentSpec = {
  ...XAU,
  symbol: 'TEST/USD',
  pricePrecision: 1,
  tickSize: '0.5',
  pointSize: '10',
  defaultTargetPoints: '15',
  defaultStopPoints: '18',
  contractMultiplier: null,
};

export function tradeState(overrides: Partial<TradeState> = {}): TradeState {
  return {
    ref: 'T-0001',
    status: 'ACTIVE',
    version: 2,
    spec: XAU,
    direction: 'BUY',
    entry: { type: 'SINGLE', low: '3300', high: '3300' },
    originalStopLoss: '3120',
    stopLoss: '3120',
    targets: [{ index: 1, price: '3450', originalPrice: '3450', status: 'OPEN', hitAt: null }],
    closedFraction: '0',
    closureBasis: null,
    execution: null,
    activatedAt: '2026-11-01T10:00:00.000Z',
    closedAt: null,
    closures: [],
    ...overrides,
  };
}

export const KEY = '6b1f0a52-4f55-4b8e-9d10-111111111111';
export const NOW = new Date('2026-11-05T10:00:00.000Z');
