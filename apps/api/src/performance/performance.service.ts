import { Injectable } from '@nestjs/common';
import {
  aggregateClosures,
  type CalculationBasis,
  computePerformanceStats,
  endOfLocalDateExclusive,
  localDateToInstant,
  METHODOLOGY_VERSION,
  type PerformanceStats,
  type StatsTrade,
  type TradeAggregate,
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
  ],
};

const MAX_TRADES = 5000;

export interface PerformanceFilter {
  from?: string;
  to?: string;
  symbol?: string;
  basis?: CalculationBasis;
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
      ...(filter.from || filter.to
        ? {
            publishedAt: {
              ...(filter.from ? { gte: localDateToInstant(filter.from, tz) } : {}),
              ...(filter.to ? { lt: endOfLocalDateExclusive(filter.to, tz) } : {}),
            },
          }
        : {}),
    };
    const rows = await this.prisma.trade.findMany({
      where,
      include: { closures: { orderBy: { createdAt: 'asc' } } },
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
        corrected: row.closures.some((c) => c.supersededByEventId !== null),
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

  async publicResults(filter: { from?: string; to?: string; symbol?: string }) {
    const { rows } = await this.load(filter);
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
    return {
      measurementPeriod: { from: first?.toISOString() ?? null, to: last?.toISOString() ?? null },
      lifecycle: withoutMoney(computePerformanceStats(all)),
      hypothetical: stats('HYPOTHETICAL_OUTCOME'),
      declared: stats('ADMIN_DECLARED_EXECUTION'),
      records: rows
        .filter(({ row }) => ['CLOSED', 'CANCELLED', 'EXPIRED'].includes(row.status))
        .reverse()
        .slice(0, 200)
        .map(({ row, aggregate }) => ({
          ref: row.ref,
          symbol: (row.instrumentSpec as unknown as { symbol: string }).symbol,
          direction: row.direction,
          status: row.status,
          publishedAt: row.publishedAt?.toISOString() ?? null,
          closedAt: row.closedAt?.toISOString() ?? null,
          basis: aggregate?.basis ?? null,
          weightedPoints: aggregate?.weightedPoints ?? null,
          outcome: aggregate?.outcome ?? null,
        })),
      methodology: METHODOLOGY,
    };
  }
}
