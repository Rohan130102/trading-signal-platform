import { Injectable } from '@nestjs/common';
import { canArchiveTrade, localDateToInstant, TERMINAL_STATUSES, type TradeStatus } from '@signaldesk/domain';
import { AppError } from '../common/http.js';
import { Prisma, PrismaService, type Tx, TX_OPTIONS } from '../db/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SettingsService } from '../settings/settings.service.js';

interface Actor {
  id: string;
  requestId: string;
}

/**
 * Administrative archive: finished trades leave the subscribers' Signals list and stay in History, with
 * every event intact. Published trades are never deleted: the record of what was sent is append-only,
 * and removing losing trades from it would make the history misleading.
 */
@Injectable()
export class TradeArchiveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  private async beforeWhere(before: string): Promise<Prisma.TradeWhereInput> {
    const cutoff = localDateToInstant(before, await this.settings.timezone());
    return {
      status: { in: [...TERMINAL_STATUSES] as TradeStatus[] },
      archive: { is: null },
      OR: [{ closedAt: { lt: cutoff } }, { closedAt: null, updatedAt: { lt: cutoff } }],
    };
  }

  /** How many finished trades an archive-before would move, so the administrator confirms a real number. */
  async preview(before: string): Promise<{ count: number }> {
    return { count: await this.prisma.trade.count({ where: await this.beforeWhere(before) }) };
  }

  async archive(tradeIds: string[], expectedCount: number, reason: string | undefined, actor: Actor) {
    const ids = [...new Set(tradeIds)];
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; status: TradeStatus; archived: boolean }[]>`
        SELECT t.id, t.status, (a.trade_id IS NOT NULL) AS archived
        FROM trades t LEFT JOIN trade_archives a ON a.trade_id = t.id
        WHERE t.id = ANY(${ids}::uuid[]) FOR UPDATE OF t`;
      const eligible = rows.filter((r) => canArchiveTrade(r.status) && !r.archived).map((r) => r.id);
      if (eligible.length !== ids.length || eligible.length !== expectedCount) {
        throw new AppError(
          409,
          'SELECTION_CHANGED',
          `${eligible.length} of the ${ids.length} selected can be archived. Only finished trades that are not archived yet qualify.`,
          { eligible },
        );
      }
      return this.write(tx, eligible, reason, actor, { mode: 'SELECTION' });
    }, TX_OPTIONS);
  }

  async archiveBefore(before: string, expectedCount: number, reason: string | undefined, actor: Actor) {
    const where = await this.beforeWhere(before);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.trade.findMany({ where, select: { id: true } });
      if (rows.length !== expectedCount) {
        throw new AppError(
          409,
          'SELECTION_CHANGED',
          `${rows.length} trades qualify now, not ${expectedCount}. Check the number and confirm again.`,
          { count: rows.length },
        );
      }
      const ids = rows.map((r) => r.id);
      await tx.$queryRaw`SELECT id FROM trades WHERE id = ANY(${ids}::uuid[]) FOR UPDATE`;
      return this.write(tx, ids, reason, actor, { mode: 'BEFORE', before });
    }, TX_OPTIONS);
  }

  async unarchive(tradeIds: string[], actor: Actor) {
    const ids = [...new Set(tradeIds)];
    return this.prisma.$transaction(async (tx) => {
      const removed = await tx.tradeArchive.deleteMany({ where: { tradeId: { in: ids } } });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'TRADES_UNARCHIVED',
          targetType: 'trade',
          metadata: { ids, count: removed.count },
          requestId: actor.requestId,
        },
        tx,
      );
      return { restored: removed.count };
    }, TX_OPTIONS);
  }

  private async write(tx: Tx, ids: string[], reason: string | undefined, actor: Actor, extra: Record<string, unknown>) {
    if (ids.length > 0) {
      await tx.tradeArchive.createMany({
        data: ids.map((tradeId) => ({ tradeId, archivedById: actor.id, reason: reason ?? null })),
        skipDuplicates: true,
      });
    }
    await this.audit.record(
      {
        actorId: actor.id,
        action: 'TRADES_ARCHIVED',
        targetType: 'trade',
        metadata: { ids, count: ids.length, reason: reason ?? null, ...extra },
        requestId: actor.requestId,
      },
      tx,
    );
    return { archived: ids.length };
  }
}
