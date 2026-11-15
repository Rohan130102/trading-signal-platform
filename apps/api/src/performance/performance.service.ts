import { Injectable } from '@nestjs/common';
import {
  aggregateClosures,
  endOfLocalDateExclusive,
  type FinishedTrade,
  localDateToInstant,
  type PerformanceReport,
  type PublicTradeRecord,
  type ReportTrade,
  summarizePerformance,
  type TradeAggregate,
} from '@signaldesk/domain';
import { env } from '../config/env.js';
import { Prisma, PrismaService } from '../db/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { toClosureRecord, toTradeSummary } from '../trades/mappers.js';

const MAX_TRADES = 5000;
const FINISHED = new Set(['CLOSED', 'CANCELLED', 'EXPIRED']);

export interface PerformanceFilter {
  from?: string;
  to?: string;
  symbol?: string;
}

/**
 * Performance, from the trades themselves. The administrators' dashboard, the subscriber history and the public
 * results all read the same trades and closures, and the figures come from one calculation (`summarizePerformance`).
 * A closed trade appears here the moment it closes: there is no approval step.
 */
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
    // Removed trades are loaded like any other: every figure counts them, so hiding a trade never improves results.
    const rows = await this.prisma.trade.findMany({
      where,
      include: {
        closures: { orderBy: { createdAt: 'asc' } },
        removal: { select: { tradeId: true } },
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
        const lastExit = current.reduce<Date | null>(
          (at, c) => (at === null || c.exitedAt > at ? c.exitedAt : at),
          null,
        );
        const finishedAt = (row.closedAt ?? lastExit)?.toISOString() ?? null;
        const symbol = (row.instrumentSpec as unknown as { symbol: string }).symbol;
        return { row, aggregate, finishedAt, symbol };
      }),
    };
  }

  private static reportTrades(rows: Awaited<ReturnType<PerformanceService['load']>>['rows']): ReportTrade[] {
    return rows.map(({ row, aggregate, finishedAt, symbol }) => ({
      status: row.status,
      aggregate,
      symbol,
      ref: row.ref ?? '',
      finishedAt,
    }));
  }

  async report(filter: PerformanceFilter): Promise<PerformanceReport> {
    const { rows, truncated } = await this.load(filter);
    const summary = summarizePerformance(PerformanceService.reportTrades(rows), filter.symbol || undefined);
    const trades: FinishedTrade[] = rows
      .filter(({ row }) => FINISHED.has(row.status))
      .sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''))
      .slice(0, 500)
      .map(({ row, aggregate, finishedAt }) => ({
        ...toTradeSummary(row),
        exit: aggregate?.averageExit ?? null,
        points: aggregate?.outcome === 'UNRESOLVED' ? null : (aggregate?.weightedPoints ?? null),
        outcome: aggregate && aggregate.outcome !== 'UNRESOLVED' ? aggregate.outcome : null,
        finishedAt,
        corrected: row._count.events > 0,
      }));
    return { ...summary, trades, truncated };
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

  /** The same report, without prices or money: counts, results and points only. */
  async publicResults(filter: PerformanceFilter) {
    const { rows } = await this.load(filter);
    const summary = summarizePerformance(PerformanceService.reportTrades(rows), filter.symbol || undefined);
    const first = rows[0]?.row.publishedAt ?? null;
    const last = rows[rows.length - 1]?.row.publishedAt ?? null;
    const records: PublicTradeRecord[] = rows
      .filter(({ row }) => FINISHED.has(row.status))
      .sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''))
      .slice(0, 1000)
      .map(({ row, aggregate, finishedAt, symbol }) => ({
        ref: row.ref,
        symbol,
        direction: row.direction,
        status: row.status,
        publishedAt: row.publishedAt?.toISOString() ?? null,
        finishedAt,
        weightedPoints: aggregate?.outcome === 'UNRESOLVED' ? null : (aggregate?.weightedPoints ?? null),
        outcome: aggregate && aggregate.outcome !== 'UNRESOLVED' ? aggregate.outcome : null,
        corrected: row._count.events > 0,
      }));
    return {
      ...summary,
      measurementPeriod: { from: first?.toISOString() ?? null, to: last?.toISOString() ?? null },
      records,
    };
  }
}
