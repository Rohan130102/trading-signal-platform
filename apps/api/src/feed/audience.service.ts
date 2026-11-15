import { Injectable } from '@nestjs/common';
import {
  type EntitlementPeriod,
  entitlementPeriods,
  PUBLIC_ANNOUNCEMENT_CATEGORIES,
  withinPeriods,
} from '@signaldesk/domain';
import { Prisma, PrismaService } from '../db/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';

/** Null: no restriction (administrators, or the ALL history scope). */
export type Periods = EntitlementPeriod[] | null;

/** What the live-update stream knows about an alert, to apply the same rules as the lists. */
export interface AlertScope {
  createdAt: string;
  tradePublishedAt: string | null;
  hasTrade: boolean;
  removed: boolean;
}

/**
 * Who sees what on the subscriber screens. One rule, applied by every list, detail, count, badge, live update and
 * push notification:
 *
 * 1. Trades the Master Admin removed from subscriber screens are left out, with all their alerts.
 * 2. With the MEMBERSHIP history scope (the default), a subscriber sees what was published while they were entitled:
 *    their subscription and trial periods, each from its start until it ended or was replaced. A trade published
 *    before, or during a lapse, stays out with all its later updates. Announcements follow the same rule, except
 *    notices about the service, which stay on the board for everyone signed in.
 *
 * Both are views. The trades, their events and every figure computed from them are untouched.
 */
@Injectable()
export class AudienceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** The periods whose content each person may see. */
  async periodsFor(userIds: string[]): Promise<Map<string, Periods>> {
    if (userIds.length === 0) return new Map();
    const [platform, users] = await Promise.all([
      this.settings.platform(),
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true,
          role: true,
          subscription: {
            select: {
              startsAt: true,
              expiresAt: true,
              events: { select: { createdAt: true, newStartsAt: true, newExpiresAt: true } },
            },
          },
        },
      }),
    ]);
    return new Map(
      users.map((user): [string, Periods] => {
        if (user.role === 'ADMIN' || platform.historyScope === 'ALL') return [user.id, null];
        const sub = user.subscription;
        const changes = (sub?.events ?? []).map((e) => ({
          at: e.createdAt,
          startsAt: e.newStartsAt,
          expiresAt: e.newExpiresAt,
        }));
        return [user.id, entitlementPeriods(changes, sub)];
      }),
    );
  }

  async periods(userId: string): Promise<Periods> {
    return (await this.periodsFor([userId])).get(userId) ?? [];
  }

  private static ranges(field: 'publishedAt' | 'createdAt', periods: EntitlementPeriod[]) {
    return periods.map((p) => ({ [field]: { gte: p.from, lt: p.to } }));
  }

  /** Trades this person may see. Combine with other conditions through AND. */
  tradeWhere(periods: Periods): Prisma.TradeWhereInput {
    return {
      AND: [
        { removal: { is: null } },
        ...(periods ? [{ OR: AudienceService.ranges('publishedAt', periods) as Prisma.TradeWhereInput[] }] : []),
      ],
    };
  }

  /**
   * Alerts this person may see: sent while they were entitled and, for a trade, about a trade they may see. A service
   * notice published before they joined is on the board, but was never one of their alerts.
   */
  eventWhere(periods: Periods): Prisma.SignalEventWhereInput {
    return {
      AND: [
        { OR: [{ tradeId: null }, { trade: { removal: { is: null } } }] },
        ...(periods
          ? [
              { OR: AudienceService.ranges('createdAt', periods) as Prisma.SignalEventWhereInput[] },
              {
                OR: [
                  { tradeId: null },
                  { trade: { OR: AudienceService.ranges('publishedAt', periods) as Prisma.TradeWhereInput[] } },
                ],
              },
            ]
          : []),
      ],
    };
  }

  /** Announcements on the board this person may read. */
  announcementWhere(periods: Periods): Prisma.AnnouncementRecordWhereInput {
    if (!periods) return {};
    return {
      OR: [
        { category: { in: [...PUBLIC_ANNOUNCEMENT_CATEGORIES] } },
        ...(AudienceService.ranges('publishedAt', periods) as Prisma.AnnouncementRecordWhereInput[]),
      ],
    };
  }

  /** The same rule as `eventWhere`, for one alert the live-update stream is about to send. */
  static alertVisible(alert: AlertScope, periods: Periods): boolean {
    if (alert.removed) return false;
    if (periods === null) return true;
    if (!withinPeriods(alert.createdAt, periods)) return false;
    return !alert.hasTrade || withinPeriods(alert.tradePublishedAt, periods);
  }

  /**
   * Unread alerts per person, by the same rules as the lists, in one query: the in-app count and the app icon
   * badge always agree.
   */
  async unreadCounts(userIds: string[]): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();
    const scopes = await this.periodsFor(userIds);
    const unrestricted = userIds.filter((id) => scopes.get(id) === null);
    const owners: string[] = [];
    const froms: Date[] = [];
    const tos: Date[] = [];
    for (const [id, periods] of scopes) {
      for (const p of periods ?? []) {
        owners.push(id);
        froms.push(p.from);
        tos.push(p.to);
      }
    }
    const rows = await this.prisma.$queryRaw<{ id: string; unread: bigint }[]>`
      WITH p AS (
        SELECT * FROM unnest(${owners}::uuid[], ${froms}::timestamptz[], ${tos}::timestamptz[]) AS p(user_id, f, t)
      )
      SELECT u.id, (
        SELECT count(*) FROM signal_events e
        LEFT JOIN trade_removals tr ON tr.trade_id = e.trade_id
        LEFT JOIN trades tt ON tt.id = e.trade_id
        WHERE e.broadcast AND e.seq > u.last_read_seq
          AND tr.trade_id IS NULL
          AND (
            u.id = ANY(${unrestricted}::uuid[])
            OR (
              EXISTS (SELECT 1 FROM p WHERE p.user_id = u.id AND e.created_at >= p.f AND e.created_at < p.t)
              AND (
                e.trade_id IS NULL
                OR EXISTS (SELECT 1 FROM p WHERE p.user_id = u.id AND tt.published_at >= p.f AND tt.published_at < p.t)
              )
            )
          )
          AND NOT EXISTS (SELECT 1 FROM notification_reads r WHERE r.user_id = u.id AND r.event_id = e.id)
      ) AS unread
      FROM users u
      WHERE u.id = ANY(${userIds}::uuid[])`;
    return new Map(rows.map((r) => [r.id, Number(r.unread)]));
  }

  async unreadCount(userId: string): Promise<number> {
    return (await this.unreadCounts([userId])).get(userId) ?? 0;
  }

  /** Of these people, the ones who may be told about a trade published at this moment. */
  async mayFollowTrade(userIds: string[], publishedAt: Date | null): Promise<string[]> {
    const scopes = await this.periodsFor(userIds);
    return userIds.filter((id) => {
      const periods = scopes.get(id);
      return periods === undefined ? false : withinPeriods(publishedAt, periods);
    });
  }
}
