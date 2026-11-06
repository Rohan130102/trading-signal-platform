import { Injectable } from '@nestjs/common';
import {
  type AdminEvent,
  type AdminTradeDetail,
  aggregateClosures,
  allowedActions,
  type DispatchSummary,
  type FeedPage,
  LIVE_STATUSES,
  localDateToInstant,
  endOfLocalDateExclusive,
  type TradeDetail,
  type TradeStatus,
  type TradeSummary,
} from '@signaldesk/domain';
import { notFound } from '../common/http.js';
import { Prisma, PrismaService, str } from '../db/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { toAdminClosure, toClosureRecord, toFeedEvent, toPublicOutcome, toTradeSummary } from './mappers.js';

const WITH_LAST = {
  events: { where: { broadcast: true }, orderBy: { seq: 'desc' as const }, take: 1 },
  _count: { select: { events: { where: { broadcast: true } } } },
};

export interface HistoryFilter {
  q?: string;
  symbol?: string;
  status?: TradeStatus;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

@Injectable()
export class TradesQueries {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async feed(
    userId: string,
    query: { before?: number; after?: number; limit: number; symbol?: string },
  ): Promise<FeedPage> {
    const ascending = query.after !== undefined;
    const where: Prisma.SignalEventWhereInput = {
      broadcast: true,
      ...(ascending ? { seq: { gt: BigInt(query.after as number) } } : {}),
      ...(query.before !== undefined ? { seq: { lt: BigInt(query.before) } } : {}),
      ...(query.symbol ? { payload: { path: ['symbol'], equals: query.symbol } } : {}),
    };
    const rows = await this.prisma.signalEvent.findMany({
      where,
      orderBy: { seq: ascending ? 'asc' : 'desc' },
      take: query.limit + 1,
      include: { trade: { select: { status: true } } },
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const [head, user] = await Promise.all([
      this.prisma.signalEvent.aggregate({ where: { broadcast: true }, _max: { seq: true } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { lastReadSeq: true } }),
    ]);
    const unread = await this.prisma.signalEvent.count({ where: { broadcast: true, seq: { gt: user.lastReadSeq } } });
    return {
      events: page.map((r) => toFeedEvent(r, r.trade?.status ?? null)),
      headSeq: Number(head._max.seq ?? 0),
      lastReadSeq: Number(user.lastReadSeq),
      unread,
      hasMore,
    };
  }

  async markRead(userId: string, seq: number): Promise<number> {
    const head = await this.prisma.signalEvent.aggregate({ where: { broadcast: true }, _max: { seq: true } });
    const bounded = BigInt(Math.min(seq, Number(head._max.seq ?? 0)));
    // Monotonic: a slower tab can never move the read marker backwards.
    await this.prisma
      .$executeRaw`UPDATE users SET last_read_seq = GREATEST(last_read_seq, ${bounded}) WHERE id = ${userId}::uuid`;
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { lastReadSeq: true } });
    return this.prisma.signalEvent.count({ where: { broadcast: true, seq: { gt: user.lastReadSeq } } });
  }

  async activeTrades(): Promise<TradeSummary[]> {
    const rows = await this.prisma.trade.findMany({
      where: { status: { in: [...LIVE_STATUSES] as TradeStatus[] } },
      orderBy: { publishedAt: 'desc' },
      include: WITH_LAST,
    });
    return rows.map(toTradeSummary);
  }

  private async historyWhere(filter: HistoryFilter): Promise<Prisma.TradeWhereInput> {
    const tz = await this.settings.timezone();
    const q = filter.q?.trim();
    return {
      status: filter.status ?? { not: 'DRAFT' },
      ...(filter.symbol ? { instrument: { symbol: filter.symbol } } : {}),
      ...(q
        ? {
            OR: [
              { ref: { contains: q, mode: 'insensitive' } },
              { instrument: { symbol: { contains: q, mode: 'insensitive' } } },
              { commentary: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(filter.from || filter.to
        ? {
            publishedAt: {
              ...(filter.from ? { gte: localDateToInstant(filter.from, tz) } : {}),
              ...(filter.to ? { lt: endOfLocalDateExclusive(filter.to, tz) } : {}),
            },
          }
        : {}),
    };
  }

  async history(filter: HistoryFilter) {
    const where = await this.historyWhere(filter);
    const [rows, total] = await Promise.all([
      this.prisma.trade.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
        include: { ...WITH_LAST, closures: true },
      }),
      this.prisma.trade.count({ where }),
    ]);
    return {
      trades: rows.map((r) => ({
        ...toTradeSummary(r),
        outcome: toPublicOutcome(r.closures, r.status === 'CLOSED'),
      })),
      total,
      page: filter.page,
      pageSize: filter.pageSize,
    };
  }

  async subscriberDetail(id: string): Promise<TradeDetail> {
    const row = await this.prisma.trade.findFirst({
      where: { id, status: { not: 'DRAFT' } },
      include: { ...WITH_LAST, closures: true },
    });
    if (!row) throw notFound('Trade not found');
    const events = await this.prisma.signalEvent.findMany({
      where: { tradeId: id, broadcast: true },
      orderBy: { seq: 'asc' },
    });
    return {
      ...toTradeSummary(row),
      events: events.map((e) => toFeedEvent(e, row.status)),
      outcome: toPublicOutcome(row.closures, row.status === 'CLOSED'),
    };
  }

  async adminList(filter: HistoryFilter & { live?: boolean }) {
    const base = await this.historyWhere(filter);
    const where: Prisma.TradeWhereInput =
      filter.live === true ? { ...base, status: { in: [...LIVE_STATUSES] as TradeStatus[] } } : base;
    const [rows, total] = await Promise.all([
      this.prisma.trade.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
        include: { ...WITH_LAST, closures: true },
      }),
      this.prisma.trade.count({ where }),
    ]);
    return {
      trades: rows.map((r) => {
        const closures = r.closures.filter((c) => c.supersededByEventId === null);
        return {
          ...toTradeSummary(r),
          aggregate:
            closures.length > 0 ? aggregateClosures(closures.map(toClosureRecord), r.status === 'CLOSED') : null,
        };
      }),
      total,
      page: filter.page,
      pageSize: filter.pageSize,
    };
  }

  async dispatchSummaries(eventIds: string[]): Promise<Map<string, DispatchSummary>> {
    const out = new Map<string, DispatchSummary>();
    if (eventIds.length === 0) return out;
    const [events, grouped, fanouts] = await Promise.all([
      this.prisma.signalEvent.findMany({
        where: { id: { in: eventIds }, broadcast: true },
        select: { id: true, seq: true, outbox: { select: { status: true } } },
      }),
      this.prisma.pushDelivery.groupBy({
        by: ['eventId', 'status'],
        where: { eventId: { in: eventIds } },
        _count: { _all: true },
      }),
      this.prisma.fanoutMetric.groupBy({
        by: ['eventId'],
        where: { eventId: { in: eventIds } },
        _sum: { recipients: true },
      }),
    ]);
    for (const event of events) {
      const counts = (statuses: string[]) =>
        grouped
          .filter((g) => g.eventId === event.id && statuses.includes(g.status))
          .reduce((sum, g) => sum + g._count._all, 0);
      const pending = counts(['PENDING', 'SENDING', 'RETRY']);
      const failed = counts(['FAILED']);
      const accepted = counts(['ACCEPTED']);
      const invalidated = counts(['GONE']);
      const skipped = counts(['SKIPPED']);
      const outbox = event.outbox?.status;
      let stage: DispatchSummary['stage'];
      if (outbox === 'DEAD') stage = 'FAILED';
      else if (outbox === 'PENDING' || outbox === undefined) stage = 'PENDING';
      else if (outbox === 'PROCESSING' || pending > 0) stage = 'IN_PROGRESS';
      else stage = failed > 0 ? 'FAILED' : 'COMPLETED';
      out.set(event.id, {
        eventId: event.id,
        seq: Number(event.seq),
        stage,
        devices: pending + failed + accepted + invalidated + skipped,
        accepted,
        pending,
        failed,
        invalidated,
        skipped,
        liveSends: fanouts.find((f) => f.eventId === event.id)?._sum.recipients ?? 0,
      });
    }
    return out;
  }

  async adminDetail(id: string): Promise<AdminTradeDetail> {
    const row = await this.prisma.trade.findFirst({
      where: { id, status: { not: 'DRAFT' } },
      include: {
        ...WITH_LAST,
        closures: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!row) throw notFound('Trade not found');
    const events = await this.prisma.signalEvent.findMany({
      where: { tradeId: id },
      orderBy: { seq: 'asc' },
      include: { actor: { select: { name: true } } },
    });
    const dispatch = await this.dispatchSummaries(events.filter((e) => e.broadcast).map((e) => e.id));
    const current = row.closures.filter((c) => c.supersededByEventId === null);
    const spec = row.instrumentSpec as unknown as { contractMultiplier: string | null; tickSize: string };
    return {
      ...toTradeSummary(row),
      events: events.map((e): AdminEvent => ({
        ...toFeedEvent(e, row.status),
        actorName: e.actor?.name ?? null,
        broadcast: e.broadcast,
        dispatch: dispatch.get(e.id) ?? null,
      })),
      closures: row.closures.map(toAdminClosure),
      aggregate: current.length > 0 ? aggregateClosures(current.map(toClosureRecord), row.status === 'CLOSED') : null,
      execution: row.executionEntry
        ? {
            basis: 'ADMIN_DECLARED_EXECUTION',
            entryPrice: str(row.executionEntry),
            quantity: str(row.executionQuantity),
          }
        : null,
      allowedActions: allowedActions(row.status),
      contractMultiplier: spec.contractMultiplier,
      tickSize: spec.tickSize,
    };
  }
}
