import { describe, expect, it } from 'vitest';
import {
  aggregateClosures,
  type ClosureRecord,
  computeClosureResult,
  computePerformanceStats,
  type ReportTrade,
  type StatsTrade,
  summarizePerformance,
  type TradeAggregate,
} from '../src/index.js';

const base = {
  direction: 'BUY' as const,
  basis: 'ADMIN_DECLARED_EXECUTION' as const,
  entryPrice: '3300',
  exitPrice: '3450',
  fraction: '1',
  quantity: '2',
  contractMultiplier: '100',
  fees: '25',
  pointSize: '1',
};

describe('closure result', () => {
  it('long: (exit - entry) x qty x multiplier, less fees', () => {
    const r = computeClosureResult(base);
    expect(r.priceMove).toBe('150');
    expect(r.grossPnl).toBe('30000');
    expect(r.netPnl).toBe('29975');
  });

  it('short: (entry - exit) x qty x multiplier', () => {
    const r = computeClosureResult({ ...base, direction: 'SELL', exitPrice: '3150', fees: null });
    expect(r.priceMove).toBe('150');
    expect(r.grossPnl).toBe('30000');
    expect(r.netPnl).toBe('30000');
  });

  it('a losing long and a losing short are both negative', () => {
    expect(computeClosureResult({ ...base, exitPrice: '3120', fees: null }).grossPnl).toBe('-36000');
    expect(computeClosureResult({ ...base, direction: 'SELL', exitPrice: '3480', fees: null }).grossPnl).toBe('-36000');
  });

  it('fees can turn a small gain into a net loss', () => {
    const r = computeClosureResult({
      ...base,
      exitPrice: '3300.10',
      quantity: '1',
      contractMultiplier: '1',
      fees: '1',
    });
    expect(r.grossPnl).toBe('0.1');
    expect(r.netPnl).toBe('-0.9');
  });

  it('never invents money without a quantity', () => {
    const r = computeClosureResult({ ...base, quantity: null });
    expect(r.priceMove).toBe('150');
    expect(r.points).toBe('150');
    expect(r.grossPnl).toBeNull();
    expect(r.netPnl).toBeNull();
  });

  it('never invents money without a multiplier', () => {
    const r = computeClosureResult({ ...base, contractMultiplier: null });
    expect(r.grossPnl).toBeNull();
    expect(r.netPnl).toBeNull();
  });

  it('a hypothetical outcome has no monetary figures even with a quantity', () => {
    const r = computeClosureResult({ ...base, basis: 'HYPOTHETICAL_OUTCOME' });
    expect(r.priceMove).toBe('150');
    expect(r.grossPnl).toBeNull();
  });

  it('no basis or no entry produces no figures at all', () => {
    for (const input of [
      { ...base, basis: 'NONE' as const },
      { ...base, entryPrice: null },
    ]) {
      const r = computeClosureResult(input);
      expect(r).toMatchObject({ priceMove: null, points: null, grossPnl: null, netPnl: null });
    }
  });

  it('converts movement into instrument points', () => {
    expect(computeClosureResult({ ...base, pointSize: '10' }).points).toBe('15');
  });

  it('keeps exact decimals', () => {
    const r = computeClosureResult({
      ...base,
      entryPrice: '0.1',
      exitPrice: '0.3',
      quantity: '3',
      contractMultiplier: '1',
      fees: null,
    });
    expect(r.priceMove).toBe('0.2');
    expect(r.grossPnl).toBe('0.6');
  });

  it('stamps the methodology version', () => {
    expect(computeClosureResult(base).methodologyVersion).toBe('pnl-v1');
  });
});

const closure = (over: Partial<ClosureRecord>): ClosureRecord => ({
  fraction: '1',
  exitPrice: '3450',
  basis: 'HYPOTHETICAL_OUTCOME',
  priceMove: '150',
  points: '150',
  grossPnl: null,
  netPnl: null,
  fees: null,
  ...over,
});

describe('aggregation across partial exits', () => {
  it('weights movement by the fraction closed and counts each portion once', () => {
    const a = aggregateClosures(
      [
        closure({ fraction: '0.5', exitPrice: '3400', priceMove: '100', points: '100' }),
        closure({ fraction: '0.5', exitPrice: '3500', priceMove: '200', points: '200' }),
      ],
      true,
    );
    expect(a.closedFraction).toBe('1');
    expect(a.weightedPoints).toBe('150');
    expect(a.averageExit).toBe('3450');
    expect(a.outcome).toBe('WIN');
  });

  it('sums monetary results without double counting', () => {
    const a = aggregateClosures(
      [
        closure({
          basis: 'ADMIN_DECLARED_EXECUTION',
          fraction: '0.25',
          priceMove: '100',
          points: '100',
          grossPnl: '25',
          netPnl: '24',
          fees: '1',
        }),
        closure({
          basis: 'ADMIN_DECLARED_EXECUTION',
          fraction: '0.75',
          priceMove: '-10',
          points: '-10',
          grossPnl: '-7.5',
          netPnl: '-8.5',
          fees: '1',
        }),
      ],
      true,
    );
    expect(a.grossPnl).toBe('17.5');
    expect(a.netPnl).toBe('15.5');
    expect(a.fees).toBe('2');
    expect(a.outcome).toBe('WIN');
  });

  it('net decides the outcome when money is known', () => {
    const a = aggregateClosures(
      [
        closure({
          basis: 'ADMIN_DECLARED_EXECUTION',
          priceMove: '1',
          points: '1',
          grossPnl: '1',
          netPnl: '-2',
          fees: '3',
        }),
      ],
      true,
    );
    expect(a.outcome).toBe('LOSS');
  });

  it('a trade still partly open has no final outcome', () => {
    expect(aggregateClosures([closure({ fraction: '0.5' })], false).outcome).toBe('UNRESOLVED');
  });

  it('flat results are breakeven, not a win', () => {
    expect(aggregateClosures([closure({ priceMove: '0', points: '0', exitPrice: '3300' })], true).outcome).toBe(
      'BREAKEVEN',
    );
  });

  it('refuses to blend mixed bases', () => {
    const a = aggregateClosures(
      [closure({ fraction: '0.5' }), closure({ fraction: '0.5', basis: 'ADMIN_DECLARED_EXECUTION' })],
      true,
    );
    expect(a.outcome).toBe('UNRESOLVED');
    expect(a.weightedPoints).toBeNull();
    expect(a.grossPnl).toBeNull();
  });

  it('an unmeasurable portion leaves the whole trade unresolved', () => {
    const a = aggregateClosures([closure({ basis: 'NONE', priceMove: null, points: null })], true);
    expect(a.outcome).toBe('UNRESOLVED');
    expect(a.weightedPoints).toBeNull();
  });

  it('no monetary total if only some exits have money', () => {
    const a = aggregateClosures(
      [
        closure({ basis: 'ADMIN_DECLARED_EXECUTION', fraction: '0.5', grossPnl: '10', netPnl: '10' }),
        closure({ basis: 'ADMIN_DECLARED_EXECUTION', fraction: '0.5' }),
      ],
      true,
    );
    expect(a.grossPnl).toBeNull();
    expect(a.netPnl).toBeNull();
    expect(a.outcome).toBe('WIN');
  });
});

describe('performance statistics', () => {
  const closed = (points: string, net: string | null = null): StatsTrade => ({
    status: 'CLOSED',
    symbol: 'XAU/USD',
    aggregate: aggregateClosures(
      [
        closure({
          priceMove: points,
          points,
          grossPnl: net,
          netPnl: net,
          basis: net ? 'ADMIN_DECLARED_EXECUTION' : 'HYPOTHETICAL_OUTCOME',
        }),
      ],
      true,
    ),
  });
  const other = (status: string): StatsTrade => ({ status, symbol: 'XAU/USD', aggregate: null });

  it('keeps open, cancelled and untriggered out of the denominator but still reports them', () => {
    const s = computePerformanceStats([
      closed('100'),
      closed('-50'),
      closed('0'),
      other('ACTIVE'),
      other('PARTIALLY_CLOSED'),
      other('PUBLISHED'),
      other('CANCELLED'),
      other('EXPIRED'),
    ]);
    expect(s.totalRecords).toBe(8);
    expect(s.wins).toBe(1);
    expect(s.losses).toBe(1);
    expect(s.breakevens).toBe(1);
    expect(s.winRateDenominator).toBe(3);
    expect(s.winRate).toBe('0.333333');
    expect(s.open).toBe(2);
    expect(s.awaitingEntry).toBe(1);
    expect(s.cancelled).toBe(1);
    expect(s.expiredWithoutEntry).toBe(1);
  });

  it('counts a closed trade with no measurable basis as unresolved rather than dropping it', () => {
    const s = computePerformanceStats([other('CLOSED'), closed('10')]);
    expect(s.finalized).toBe(2);
    expect(s.unresolved).toBe(1);
    expect(s.winRateDenominator).toBe(1);
  });

  it('has no win rate at all when nothing is measurable', () => {
    const s = computePerformanceStats([other('ACTIVE')]);
    expect(s.winRate).toBeNull();
    expect(s.winRateDenominator).toBe(0);
  });

  it('computes averages by outcome', () => {
    const s = computePerformanceStats([closed('100'), closed('200'), closed('-30'), closed('-10')]);
    expect(s.averageWinPoints).toBe('150');
    expect(s.averageLossPoints).toBe('-20');
    expect(s.netPoints).toBe('260');
  });

  it('reports money only for trades that have it and says how many', () => {
    const s = computePerformanceStats([closed('100', '500'), closed('-30', '-120'), closed('10')]);
    expect(s.monetaryTrades).toBe(2);
    expect(s.netPnl).toBe('380');
    expect(s.averageWinNet).toBe('500');
    expect(s.averageLossNet).toBe('-120');
  });

  it('reports no money at all when none exists', () => {
    const s = computePerformanceStats([closed('100')]);
    expect(s.netPnl).toBeNull();
    expect(s.monetaryTrades).toBe(0);
  });
});

describe('one performance report', () => {
  const result = (outcome: TradeAggregate['outcome'], points: string | null): TradeAggregate => ({
    basis: 'HYPOTHETICAL_OUTCOME',
    closedFraction: '1',
    averageExit: null,
    weightedPriceMove: points,
    weightedPoints: points,
    grossPnl: null,
    netPnl: null,
    fees: null,
    outcome,
  });
  let n = 0;
  const trade = (
    status: string,
    aggregate: TradeAggregate | null,
    symbol = 'XAU/USD',
    finishedAt: string | null = null,
  ): ReportTrade => ({ status, aggregate, symbol, ref: `T-${(n += 1)}`, finishedAt });

  it('counts each signal once, and the win rate only over trades with a result', () => {
    // 6 signals: 5 closed, 1 cancelled; 2 of the closed have a result, 1 win and 1 loss.
    const report = summarizePerformance([
      trade('CLOSED', result('WIN', '150'), 'XAU/USD', '2026-11-02T00:00:00Z'),
      trade('CLOSED', result('LOSS', '-80'), 'XAU/USD', '2026-11-03T00:00:00Z'),
      trade('CLOSED', result('UNRESOLVED', null)),
      trade('CLOSED', null),
      trade('CLOSED', result('UNRESOLVED', null)),
      trade('CANCELLED', null),
    ]);
    expect(report.counts).toEqual({ total: 6, closed: 5, active: 0, awaitingEntry: 0, cancelled: 1 });
    expect(report.results).toEqual({ winRate: '0.5', wins: 1, losses: 1, breakevens: 0, measured: 2 });
  });

  it('keeps points per instrument, never added across instruments', () => {
    const report = summarizePerformance([
      trade('CLOSED', result('WIN', '150'), 'XAU/USD', '2026-11-02T00:00:00Z'),
      trade('CLOSED', result('LOSS', '-50'), 'XAU/USD', '2026-11-04T00:00:00Z'),
      trade('CLOSED', result('WIN', '2300'), 'BTC/USD', '2026-11-03T00:00:00Z'),
      trade('EXPIRED', null, 'BTC/USD'),
      trade('ACTIVE', null, 'BTC/USD'),
    ]);
    expect(report.counts).toMatchObject({ total: 5, closed: 3, active: 1, cancelled: 1 });
    expect(report.instruments).toEqual([
      {
        symbol: 'BTC/USD',
        winRate: '1',
        wins: 1,
        losses: 0,
        breakevens: 0,
        measured: 1,
        netPoints: '2300',
        averagePoints: '2300',
      },
      {
        symbol: 'XAU/USD',
        winRate: '0.5',
        wins: 1,
        losses: 1,
        breakevens: 0,
        measured: 2,
        netPoints: '100',
        averagePoints: '50',
      },
    ]);
    // A running total only for one instrument, in the order trades finished.
    expect(report.running).toBeNull();
    const gold = summarizePerformance(
      [
        trade('CLOSED', result('LOSS', '-50'), 'XAU/USD', '2026-11-04T00:00:00Z'),
        trade('CLOSED', result('WIN', '150'), 'XAU/USD', '2026-11-02T00:00:00Z'),
      ],
      'XAU/USD',
    );
    expect(gold.running?.map((p) => p.total)).toEqual(['150', '100']);
  });

  it('a breakeven counts in the win rate, but not as a win', () => {
    const report = summarizePerformance([
      trade('CLOSED', result('BREAKEVEN', '0')),
      trade('CLOSED', result('WIN', '10')),
    ]);
    expect(report.results).toMatchObject({ wins: 1, breakevens: 1, measured: 2, winRate: '0.5' });
  });
});
