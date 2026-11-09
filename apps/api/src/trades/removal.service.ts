import { Injectable } from '@nestjs/common';
import { aggregateClosures, TERMINAL_STATUSES, type TradeStatus } from '@signaldesk/domain';
import { AppError } from '../common/http.js';
import { Prisma, PrismaService, TX_OPTIONS } from '../db/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { notifyRefresh } from '../db/listener.service.js';
import { toClosureRecord } from './mappers.js';

interface Actor {
  id: string;
  requestId: string;
}

/**
 * The Master Admin taking finished trades off every subscriber screen: Signals, History, Alerts and the trade
 * page, on the web and in the app. Nothing is deleted. Administrators still see the trade, marked removed; its
 * events and exits stay exactly as recorded; the audit log keeps who removed it, why, and its outcome; and every
 * performance figure keeps counting it, so taking a losing trade away can never make the results look better.
 * Live trades cannot be removed: they must be closed or cancelled first, with an alert, like any other change.
 */
@Injectable()
export class TradeRemovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async remove(tradeIds: string[], expectedCount: number, reason: string, actor: Actor) {
    const ids = [...new Set(tradeIds)];
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; ref: string | null; status: TradeStatus; removed: boolean }[]>`
        SELECT t.id, t.ref, t.status, (r.trade_id IS NOT NULL) AS removed
        FROM trades t LEFT JOIN trade_removals r ON r.trade_id = t.id
        WHERE t.id = ANY(${ids}::uuid[]) FOR UPDATE OF t`;
      const eligible = rows.filter((r) => TERMINAL_STATUSES.includes(r.status) && !r.removed);
      if (eligible.length !== ids.length || eligible.length !== expectedCount) {
        const live = rows.filter((r) => !TERMINAL_STATUSES.includes(r.status)).length;
        throw new AppError(
          409,
          'SELECTION_CHANGED',
          live > 0
            ? `${live} of the selected trades are still live. Close or cancel them first, so subscribers are told.`
            : `${eligible.length} of the ${ids.length} selected can be removed. Only finished trades that are still on screen qualify.`,
          { eligible: eligible.map((r) => r.id) },
        );
      }
      // The outcome goes into the audit entry, so a removed losing trade is visible to anyone reviewing it.
      const closures = await tx.tradeClosure.findMany({
        where: { tradeId: { in: ids }, supersededByEventId: null },
      });
      const summary = eligible.map((r) => {
        const own = closures.filter((c) => c.tradeId === r.id);
        const aggregate = own.length > 0 ? aggregateClosures(own.map(toClosureRecord), r.status === 'CLOSED') : null;
        return {
          id: r.id,
          ref: r.ref,
          status: r.status,
          outcome: aggregate?.outcome ?? null,
          weightedPoints: aggregate?.weightedPoints ?? null,
        };
      });
      await tx.tradeRemoval.createMany({
        data: ids.map((tradeId) => ({ tradeId, removedById: actor.id, reason })),
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'TRADES_REMOVED_FROM_SCREENS',
          targetType: 'trade',
          metadata: { count: ids.length, reason, trades: summary } as unknown as Prisma.InputJsonValue,
          requestId: actor.requestId,
        },
        tx,
      );
      // Open apps drop the trades straight away instead of at their next refresh.
      await notifyRefresh(tx, 'TRADES_REMOVED');
      return { removed: ids.length };
    }, TX_OPTIONS);
  }

  async restore(tradeIds: string[], actor: Actor) {
    const ids = [...new Set(tradeIds)];
    return this.prisma.$transaction(async (tx) => {
      const restored = await tx.tradeRemoval.deleteMany({ where: { tradeId: { in: ids } } });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'TRADES_RESTORED_TO_SCREENS',
          targetType: 'trade',
          metadata: { ids, count: restored.count },
          requestId: actor.requestId,
        },
        tx,
      );
      if (restored.count > 0) await notifyRefresh(tx, 'TRADES_RESTORED');
      return { restored: restored.count };
    }, TX_OPTIONS);
  }
}
