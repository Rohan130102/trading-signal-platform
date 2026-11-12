import { Injectable } from '@nestjs/common';
import {
  aggregateClosures,
  type CalculationBasis,
  computePerformanceStats,
  type Direction,
  endOfLocalDateExclusive,
  localDateToInstant,
  METHODOLOGY_VERSION,
  type PerformanceStats,
  type PublicTradeRecord,
  type StatsTrade,
  type TradeAggregate,
  type TradeOutcome,
} from '@signaldesk/domain';
import { env } from '../config/env.js';
import { Prisma, PrismaService } from '../db/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { toAdminClosure, toClosureRecord, toTradeSummary } from '../trades/mappers.js';

export const METHODOLOGY = {
  version: METHODOLOGY_VERSION,
  statements: [
    'A trade counts once, when fully closed. Partial exits are combined, weighted by the share of the position each closed.',
    'Win rate = wins / (wins + losses + breakevens), among closed trades with a measurable outcome.',
    'Open, awaiting-entry, cancelled, expired and unresolved records are excluded from win rate, and always shown beside it.',
    'Net result decides win or loss when monetary data exists. Otherwise the fraction-weighted price move decides.',
    'Hypothetical outcomes and administrator-declared executions are never combined.',
    'Administrator-declared figures are not independently verified and do not represent results achieved by any subscriber.',
    'Monetary figures appear only where an entry, a quantity and a contract multiplier were recorded. They are never estimated.',
    'Corrections replace a record visibly. The replaced record is kept and flagged.',
    'Trades removed from subscriber screens are still counted in every figure, so hiding a trade can never improve the results.',
  ],
};

/** Plain-language meanings of every term the public page shows. */
export const DEFINITIONS = [
  { term: 'Published', meaning: 'When the desk sent the signal to subscribers.' },
  {
    term: 'Activated',
    meaning:
      'When the desk marked the signal active because its entry level was reached. It is not a fill and not any subscriber’s execution.',
  },
  { term: 'Exit', meaning: 'When the last exit of the trade was recorded.' },
  {
    term: 'Points',
    meaning:
      'The price move from entry to exit in the instrument’s points, weighted by the share of the position each exit closed. Points of different instruments are not comparable.',
  },
  { term: 'Win', meaning: 'A fully closed trade whose weighted move (or net result, where recorded) is above zero.' },
  { term: 'Loss', meaning: 'A fully closed trade whose weighted move (or net result) is below zero.' },
  { term: 'Breakeven', meaning: 'A fully closed trade whose weighted move (or net result) is exactly zero.' },
  {
    term: 'Win rate',
    meaning: 'Wins divided by wins, losses and breakevens. Open, cancelled and expired signals are not in it.',
  },
  {
    term: 'Hypothetical outcome',
    meaning: 'What following the signal at its stated levels would have produced. No real trade is implied.',
  },
  {
    term: 'Declared execution',
    meaning: 'An entry and exit the desk declared. Not independently verified.',
  },
  {
    term: 'Corrected',
    meaning:
      'The record was changed after publication. Every correction was announced to subscribers and is kept in the trade’s history with what changed, from what, to what, and why. An entry declared after the trade closed is shown as declared execution.',
  },
  {
    term: 'Expired, no entry',
    meaning: 'A signal whose entry window ended before it became active. It was cancelled automatically.',
  },
];

const MAX_TRADES = 5000;

export interface PerformanceFilter {
  from?: string;
  to?: string;
  symbol?: string;
  basis?: CalculationBasis;
  direction?: Direction;
  /** Narrows the list of records only. Figures are never computed from a subset chosen by outcome. */
  outcome?: TradeOutcome;
}

@Injectable()
export class PerformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  private async load(filter: PerformanceFilter) {
    const tz = await this.settings.timezone();
    const where: Prisma.TradeWhereInput = {
      status: { not: 'DRAFT' },
      ...(filter.symbol ? { instrument: { symbol: filter.symbol } } : {}),
      ...(filter.direction ? { direction: filter.direction } : {}),
      ...(filter.from || filter.to
        ? {
            publishedAt: {
              ...(filter.from ? { gte: localDateToInstant(filter.from, tz) } : {}),
              ...(filter.to ? { lt: endOfLocalDateExclusive(filter.to, tz) } : {}),
            },
          }
        : {}),
    };
    // Removed trades are loaded like any other: every figure counts them.
    const rows = await this.prisma.trade.findMany({
      where,
      include: {
        closures: { orderBy: { createdAt: 'asc' } },
        removal: { select: { tradeId: true } },
        // Any correction at all, to levels, times or exits, is disclosed next to the record.
        _count: { select: { events: { where: { type: 'CORRECTION' } } } },
      },
      orderBy: { publishedAt: 'asc' },
      take: MAX_TRADES + 1,
    });
    return {
      truncated: rows.length > MAX_TRADES,
      rows: rows.slice(0, MAX_TRADES).map((row) => {
        const current = row.closures.filter((c) => c.supersededByEventId === null);
        const aggregate: TradeAggregate | null =
          current.length > 0 ? aggregateClosures(current.map(toClosureRecord), row.status === 'CLOSED') : null;
        return { row, aggregate };
      }),
    };
  }

  async internal(filter: PerformanceFilter) {
    const { rows, truncated } = await this.load(filter);
    const statsFor = (subset: typeof rows) =>
      computePerformanceStats(
        subset.map(({ row, aggregate }): StatsTrade => ({
          status: row.status,
          aggregate,
          symbol: (row.instrumentSpec as unknown as { symbol: string }).symbol,
        })),
      );

    // Money in different currencies cannot be added together, and points are per-instrument.
    const quoteCurrencies = new Set(
      rows.map((r) => (r.row.instrumentSpec as unknown as { quoteCurrency: string }).quoteCurrency),
    );
    const quoteCurrency = quoteCurrencies.size === 1 ? ([...quoteCurrencies][0] as string) : null;
    const moneySafe = (stats: PerformanceStats): PerformanceStats =>
      quoteCurrency ? stats : { ...stats, grossPnl: null, netPnl: null, averageWinNet: null, averageLossNet: null };

    const lifecycle = statsFor(rows);
    const bases: CalculationBasis[] = ['HYPOTHETICAL_OUTCOME', 'ADMIN_DECLARED_EXECUTION'];
    const byBasis = bases
      .filter((b) => !filter.basis || filter.basis === b)
      .map((basis) => ({
        basis,
        stats: moneySafe(statsFor(rows.filter((r) => r.row.status === 'CLOSED' && r.aggregate?.basis === basis))),
      }));

    const symbols = [...new Set(rows.map((r) => (r.row.instrumentSpec as unknown as { symbol: string }).symbol))];
    const byInstrument = symbols.map((symbol) => ({
      symbol,
      byBasis: bases.map((basis) => ({
        basis,
        stats: statsFor(
          rows.filter(
            (r) =>
              (r.row.instrumentSpec as unknown as { symbol: string }).symbol === symbol &&
              r.row.status === 'CLOSED' &&
              r.aggregate?.basis === basis,
          ),
        ),
      })),
    }));

    const records = rows
      .filter((r) => r.row.status === 'CLOSED' || r.row.status === 'CANCELLED' || r.row.status === 'EXPIRED')
      .filter((r) => !filter.basis || r.aggregate?.basis === filter.basis)
      .reverse()
      .slice(0, 500)
      .map(({ row, aggregate }) => ({
        ...toTradeSummary(row),
        aggregate,
        corrected: row._count.events > 0,
        closures: row.closures.map(toAdminClosure),
      }));

    return {
      lifecycle: moneySafe(lifecycle),
      byBasis,
      byInstrument,
      records,
      truncated,
      quoteCurrency,
      pointsComparable: symbols.length <= 1,
      methodology: METHODOLOGY,
      removedFromScreens: rows.filter((r) => r.row.removal !== null).length,
    };
  }

  /** A deployment flag and a current, unrevoked approval are both required. */
  async publicGate(now = new Date()) {
    const approval = await this.prisma.publicPerformanceApproval.findFirst({
      where: { revokedAt: null, effectiveFrom: { lte: now }, expiresAt: { gt: now } },
      orderBy: { expiresAt: 'desc' },
    });
    return {
      flagEnabled: env.PUBLIC_PERFORMANCE_ENABLED,
      approval,
      enabled: env.PUBLIC_PERFORMANCE_ENABLED && approval !== null,
    };
  }

  async publicResults(filter: PerformanceFilter) {
    const { rows } = await this.load({ ...filter, basis: undefined, outcome: undefined });
    const all = rows.map(({ row, aggregate }): StatsTrade => ({
      status: row.status,
      aggregate,
      symbol: (row.instrumentSpec as unknown as { symbol: string }).symbol,
    }));
    // Counts and movement only. Money would disclose private position sizes.
    const withoutMoney = ({
      grossPnl: _g,
      netPnl: _n,
      averageWinNet: _w,
      averageLossNet: _l,
      monetaryTrades: _m,
      ...rest
    }: PerformanceStats) => rest;
    const stats = (basis: CalculationBasis) =>
      withoutMoney(computePerformanceStats(all.filter((t) => t.status === 'CLOSED' && t.aggregate?.basis === basis)));
    const first = rows[0]?.row.publishedAt ?? null;
    const last = rows[rows.length - 1]?.row.publishedAt ?? null;
    const symbols = [...new Set(rows.map((r) => (r.row.instrumentSpec as unknown as { symbol: string }).symbol))];
    const records: PublicTradeRecord[] = rows
      .filter(({ row }) => ['CLOSED', 'CANCELLED', 'EXPIRED'].includes(row.status))
      .filter(({ aggregate }) => !filter.outcome || aggregate?.outcome === filter.outcome)
      .reverse()
      .slice(0, 1000)
      .map(({ row, aggregate }) => {
        const exits = row.closures.filter((c) => c.supersededByEventId === null);
        const lastExit = exits.reduce<Date | null>(
          (latest, c) => (latest === null || c.exitedAt > latest ? c.exitedAt : latest),
          null,
        );
        return {
          ref: row.ref,
          symbol: (row.instrumentSpec as unknown as { symbol: string }).symbol,
          direction: row.direction,
          status: row.status,
          publishedAt: row.publishedAt?.toISOString() ?? null,
          activatedAt: row.activatedAt?.toISOString() ?? null,
          exitedAt: lastExit?.toISOString() ?? null,
          closedAt: row.closedAt?.toISOString() ?? null,
          basis: aggregate?.basis ?? null,
          weightedPoints: aggregate?.weightedPoints ?? null,
          outcome: aggregate?.outcome ?? null,
          corrected: row._count.events > 0,
        };
      });
    return {
      measurementPeriod: { from: first?.toISOString() ?? null, to: last?.toISOString() ?? null },
      lifecycle: withoutMoney(computePerformanceStats(all)),
      hypothetical: stats('HYPOTHETICAL_OUTCOME'),
      declared: stats('ADMIN_DECLARED_EXECUTION'),
      records,
      removedFromScreens: rows.filter((r) => r.row.removal !== null).length,
      symbols,
      pointsComparable: symbols.length <= 1,
      methodology: { ...METHODOLOGY, definitions: DEFINITIONS },
    };
  }
}
