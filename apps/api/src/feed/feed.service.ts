import { Injectable } from '@nestjs/common';
import {
  type Direction,
  eventCategory,
  type EventType,
  type HiddenItemType,
  mobileDeepLinkPath,
  type NotificationItem,
  type NotificationsPage,
  type SignalCard,
  type SignalsPage,
  statusesForGroup,
  type StatusGroup,
  TERMINAL_STATUSES,
  type TradeStatus,
} from '@signaldesk/domain';
import { notFound } from '../common/http.js';
import { Prisma, PrismaService } from '../db/prisma.service.js';
import { toFeedEvent, toPublicOutcome, toTradeSummary } from '../trades/mappers.js';
import { AudienceService } from './audience.service.js';

/** The latest update plus up to three earlier ones, which is all a collapsed card shows. */
const RECENT_UPDATES = 4;

export interface SignalsQuery {
  symbols: string[];
  direction?: Direction;
  status: StatusGroup;
  before?: number;
  limit: number;
}

/**
 * Read models for the subscriber's own view: trades grouped with their updates, the notification list
 * with read state, and what they chose to hide. Nothing here changes shared data.
 */
@Injectable()
export class FeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audience: AudienceService,
  ) {}

  /** Events after the read marker that were not opened one by one. The badge, the tab and the list agree. */
  unreadCount(userId: string): Promise<number> {
    return this.audience.unreadCount(userId);
  }

  async hiddenIds(userId: string, type: HiddenItemType): Promise<string[]> {
    const rows = await this.prisma.userHiddenItem.findMany({
      where: { userId, itemType: type },
      select: { itemId: true },
    });
    return rows.map((r) => r.itemId);
  }

  async signals(userId: string, query: SignalsQuery): Promise<SignalsPage> {
    const statuses = statusesForGroup(query.status);
    const [user, hidden, from] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { lastReadSeq: true } }),
      this.hiddenIds(userId, 'TRADE'),
      this.audience.periods(userId),
    ]);
    const where: Prisma.TradeWhereInput = {
      AND: [this.audience.tradeWhere(from)],
      status: statuses ? { in: statuses as TradeStatus[] } : { not: 'DRAFT' },
      lastActivitySeq: query.before !== undefined ? { lt: BigInt(query.before) } : { not: null },
      archive: { is: null },
      ...(hidden.length > 0 ? { id: { notIn: hidden } } : {}),
      ...(query.symbols.length > 0 ? { instrument: { symbol: { in: query.symbols } } } : {}),
      ...(query.direction ? { direction: query.direction } : {}),
    };
    const rows = await this.prisma.trade.findMany({
      where,
      orderBy: { lastActivitySeq: 'desc' },
      take: query.limit + 1,
      include: {
        events: { where: { broadcast: true }, orderBy: { seq: 'desc' }, take: RECENT_UPDATES },
        _count: { select: { events: { where: { broadcast: true } } } },
        closures: true,
      },
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const unreadTrades = new Set(
      page.length === 0
        ? []
        : (
            await this.prisma.signalEvent.findMany({
              where: {
                broadcast: true,
                tradeId: { in: page.map((r) => r.id) },
                seq: { gt: user.lastReadSeq },
                reads: { none: { userId } },
              },
              select: { tradeId: true },
              distinct: ['tradeId'],
            })
          ).map((e) => e.tradeId),
    );
    const [head, unread] = await Promise.all([
      this.prisma.signalEvent.aggregate({ where: { broadcast: true }, _max: { seq: true } }),
      this.unreadCount(userId),
    ]);
    const cards: SignalCard[] = page.map((row) => ({
      ...toTradeSummary(row),
      // The original signal is shown by the card itself, so it is not repeated as an "update".
      recentUpdates: row.events.filter((e) => e.type !== 'SIGNAL_PUBLISHED').map((e) => toFeedEvent(e, row.status)),
      unread: unreadTrades.has(row.id),
      activitySeq: Number(row.lastActivitySeq ?? 0),
      outcome: toPublicOutcome(row.closures, row.status === 'CLOSED'),
    }));
    return {
      cards,
      nextBefore: hasMore ? (cards[cards.length - 1]?.activitySeq ?? null) : null,
      headSeq: Number(head._max.seq ?? 0),
      unread,
    };
  }

  async notifications(userId: string, query: { before?: number; limit: number }): Promise<NotificationsPage> {
    const [user, from] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { lastReadSeq: true } }),
      this.audience.periods(userId),
    ]);
    const rows = await this.prisma.signalEvent.findMany({
      where: {
        broadcast: true,
        ...this.audience.eventWhere(from),
        ...(query.before !== undefined ? { seq: { lt: BigInt(query.before) } } : {}),
      },
      orderBy: { seq: 'desc' },
      take: query.limit + 1,
      include: { reads: { where: { userId }, select: { eventId: true } } },
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const items: NotificationItem[] = page.map((row) => {
      const payload = row.payload as { symbol?: string; direction?: Direction };
      const category = eventCategory(row.type as EventType);
      return {
        seq: Number(row.seq),
        eventId: row.id,
        type: row.type as EventType,
        category,
        title: row.title,
        body: row.body,
        tradeId: row.tradeId,
        symbol: payload.symbol ?? null,
        direction: payload.direction ?? null,
        priority: row.priority,
        createdAt: row.createdAt.toISOString(),
        unread: row.seq > user.lastReadSeq && row.reads.length === 0,
        path: mobileDeepLinkPath(row.tradeId, category),
      };
    });
    return {
      items,
      unread: await this.unreadCount(userId),
      nextBefore: hasMore ? (items[items.length - 1]?.seq ?? null) : null,
    };
  }

  /** Marks single events read. Only events that exist and were broadcast can be marked. */
  async markEventsRead(userId: string, where: Prisma.SignalEventWhereInput): Promise<number> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { lastReadSeq: true } });
    const events = await this.prisma.signalEvent.findMany({
      where: { ...where, broadcast: true, seq: { gt: user.lastReadSeq }, reads: { none: { userId } } },
      select: { id: true },
      take: 500,
    });
    if (events.length > 0) {
      await this.prisma.notificationRead.createMany({
        data: events.map((e) => ({ userId, eventId: e.id })),
        skipDuplicates: true,
      });
    }
    return this.unreadCount(userId);
  }

  /** Only what this person may see can be hidden, so an old identifier reveals nothing about what exists. */
  async hide(userId: string, type: HiddenItemType, id: string): Promise<void> {
    const periods = await this.audience.periods(userId);
    const exists =
      type === 'TRADE'
        ? await this.prisma.trade.count({
            where: { id, status: { not: 'DRAFT' }, AND: [this.audience.tradeWhere(periods)] },
          })
        : await this.prisma.announcementRecord.count({
            where: { id, status: 'PUBLISHED', deletedAt: null, AND: [this.audience.announcementWhere(periods)] },
          });
    if (exists === 0) throw notFound(type === 'TRADE' ? 'Trade not found' : 'Announcement not found');
    await this.prisma.userHiddenItem.upsert({
      where: { userId_itemType_itemId: { userId, itemType: type, itemId: id } },
      create: { userId, itemType: type, itemId: id },
      update: {},
    });
  }

  /**
   * Clears this subscriber's own history: every finished trade they can see is hidden from their lists. Live
   * trades stay, because their instructions are still in force. Nobody else is affected and nothing is deleted;
   * restoreHistory brings them back.
   */
  async clearHistory(userId: string): Promise<{ cleared: number }> {
    const from = await this.audience.periods(userId);
    const rows = await this.prisma.trade.findMany({
      where: {
        AND: [this.audience.tradeWhere(from)],
        status: { in: [...TERMINAL_STATUSES] as TradeStatus[] },
        NOT: { id: { in: await this.hiddenIds(userId, 'TRADE') } },
      },
      select: { id: true },
    });
    if (rows.length > 0) {
      await this.prisma.userHiddenItem.createMany({
        data: rows.map((r) => ({ userId, itemType: 'TRADE', itemId: r.id })),
        skipDuplicates: true,
      });
    }
    return { cleared: rows.length };
  }

  async restoreHistory(userId: string): Promise<{ restored: number }> {
    const removed = await this.prisma.userHiddenItem.deleteMany({ where: { userId, itemType: 'TRADE' } });
    return { restored: removed.count };
  }

  async unhide(userId: string, type: HiddenItemType, id: string): Promise<void> {
    await this.prisma.userHiddenItem.deleteMany({ where: { userId, itemType: type, itemId: id } });
  }

  async isHidden(userId: string, type: HiddenItemType, id: string): Promise<boolean> {
    return (await this.prisma.userHiddenItem.count({ where: { userId, itemType: type, itemId: id } })) > 0;
  }
}
