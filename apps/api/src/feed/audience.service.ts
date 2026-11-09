import { Injectable } from '@nestjs/common';
import { LIVE_STATUSES, membershipStart, type TradeStatus } from '@signaldesk/domain';
import { Prisma, PrismaService } from '../db/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';

/**
 * Who sees what on the subscriber screens. Two rules, applied by every list, count and badge:
 *
 * 1. Trades the Master Admin removed from subscriber screens are left out, with all their alerts.
 * 2. With the MEMBERSHIP history scope (the default), a subscriber's lists start when their membership did:
 *    trades published or still live during it, and alerts sent during it. Live trades are always shown.
 *
 * Both are views. The trades, their events and every figure computed from them are untouched.
 */
@Injectable()
export class AudienceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** When this person's lists start. Null: no limit (administrators, or the ALL history scope). */
  async scopeStart(userId: string): Promise<Date | null> {
    const [platform, user] = await Promise.all([
      this.settings.platform(),
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          role: true,
          createdAt: true,
          subscription: { select: { startsAt: true, events: { select: { newStartsAt: true } } } },
        },
      }),
    ]);
    if (user.role === 'ADMIN' || platform.historyScope === 'ALL') return null;
    const sub = user.subscription;
    return membershipStart([sub?.startsAt, ...(sub?.events.map((e) => e.newStartsAt) ?? [])]) ?? user.createdAt;
  }

  /** Trades this person may see. Combine with other conditions through AND. */
  tradeWhere(from: Date | null): Prisma.TradeWhereInput {
    return {
      AND: [
        { removal: { is: null } },
        ...(from
          ? [
              {
                OR: [
                  { status: { in: [...LIVE_STATUSES] as TradeStatus[] } },
                  { publishedAt: { gte: from } },
                  { closedAt: { gte: from } },
                ],
              },
            ]
          : []),
      ],
    };
  }

  /** Alerts this person may see. Announcements have no trade and are only limited by time. */
  eventWhere(from: Date | null): Prisma.SignalEventWhereInput {
    return {
      AND: [
        { OR: [{ tradeId: null }, { trade: { removal: { is: null } } }] },
        ...(from ? [{ createdAt: { gte: from } }] : []),
      ],
    };
  }

  /**
   * Unread alerts per person, by the same rules as the lists, in one query: the in-app count and the app icon
   * badge always agree.
   */
  async unreadCounts(userIds: string[]): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<{ id: string; unread: bigint }[]>`
      SELECT u.id, (
        SELECT count(*) FROM signal_events e
        LEFT JOIN trade_removals tr ON tr.trade_id = e.trade_id
        WHERE e.broadcast AND e.seq > u.last_read_seq
          AND tr.trade_id IS NULL
          AND (u.role = 'ADMIN' OR settings.history_scope = 'ALL' OR e.created_at >= COALESCE(m.start, u.created_at))
          AND NOT EXISTS (SELECT 1 FROM notification_reads r WHERE r.user_id = u.id AND r.event_id = e.id)
      ) AS unread
      FROM users u
      CROSS JOIN (SELECT history_scope FROM app_settings WHERE id = 1) settings
      LEFT JOIN LATERAL (
        SELECT LEAST(min(s.starts_at), min(se.new_starts_at)) AS start
        FROM subscriptions s LEFT JOIN subscription_events se ON se.subscription_id = s.id
        WHERE s.user_id = u.id
      ) m ON true
      WHERE u.id = ANY(${userIds}::uuid[])`;
    return new Map(rows.map((r) => [r.id, Number(r.unread)]));
  }

  async unreadCount(userId: string): Promise<number> {
    return (await this.unreadCounts([userId])).get(userId) ?? 0;
  }
}
