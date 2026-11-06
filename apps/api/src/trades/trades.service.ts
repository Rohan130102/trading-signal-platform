import { Injectable } from '@nestjs/common';
import {
  calculateLevels,
  canon,
  decide,
  defaultTargetPoints,
  DomainError,
  type DraftInput,
  entryLabel,
  formatPrice,
  type InstrumentSpec,
  type NewClosure,
  publishSignalSchema,
  type SignalFields,
  snapshot,
  type TemplateContext,
  type TemplateKind,
  type TradeCommand,
  type TargetState,
  validateSignalLevels,
} from '@signaldesk/domain';
import type { z } from 'zod';
import { AppError, notFound } from '../common/http.js';
import { log } from '../common/log.js';
import { isUniqueViolation, Prisma, PrismaService, type Tx, TX_OPTIONS } from '../db/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { TemplatesService } from '../templates/templates.service.js';
import { EventStore } from './event-store.js';
import { instrumentToSpec, toTradeState } from './mappers.js';

type PublishInput = z.infer<typeof publishSignalSchema>;

export interface Actor {
  id: string | null;
  requestId?: string;
}

const SIGNAL_KINDS: TemplateKind[] = ['BUY_STANDARD', 'SELL_STANDARD', 'PRIORITY_SIGNAL'];
const DUPLICATE_WINDOW_MS = 24 * 3_600_000;

export function normalizeFields(fields: SignalFields) {
  return {
    entry: { type: fields.entryType, low: canon(fields.entryLow), high: canon(fields.entryHigh) },
    targets: fields.targets.map(canon),
    stopLoss: canon(fields.stopLoss),
  };
}

@Injectable()
export class TradesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventStore,
    private readonly templates: TemplatesService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  private async loadInstrumentSpec(instrumentId: string): Promise<InstrumentSpec> {
    const instrument = await this.prisma.instrument.findUnique({ where: { id: instrumentId } });
    if (!instrument) throw new AppError(422, 'INSTRUMENT_NOT_FOUND', 'That instrument no longer exists.');
    if (!instrument.active) throw new AppError(422, 'INSTRUMENT_INACTIVE', `${instrument.symbol} is switched off.`);
    return instrumentToSpec(instrument);
  }

  /** Server-side recalculation of everything the composer shows, used for its authoritative preview. */
  async validateSignal(fields: SignalFields) {
    const spec = await this.loadInstrumentSpec(fields.instrumentId);
    const { entry, targets, stopLoss } = normalizeFields(fields);
    const issues = validateSignalLevels({ spec, direction: fields.direction, entry, targets, stopLoss });
    if (issues.length > 0) throw new AppError(422, 'VALIDATION', issues[0]?.message ?? 'Invalid signal', { issues });
    return { spec, entry, targets, stopLoss };
  }

  private async findLikelyDuplicate(fields: SignalFields, entry: { low: string; high: string }) {
    return this.prisma.trade.findFirst({
      where: {
        instrumentId: fields.instrumentId,
        direction: fields.direction,
        entryLow: entry.low,
        entryHigh: entry.high,
        status: { in: ['PUBLISHED', 'ACTIVE', 'PARTIALLY_CLOSED'] },
        publishedAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
      },
      select: { id: true, ref: true, publishedAt: true },
    });
  }

  private async replayedTradeId(key: string, tradeId?: string): Promise<string | null> {
    const existing = await this.prisma.signalEvent.findUnique({
      where: { idempotencyKey: key },
      select: { tradeId: true },
    });
    if (!existing) return null;
    if (tradeId && existing.tradeId !== tradeId) {
      throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'This request key was already used for another trade.');
    }
    return existing.tradeId;
  }

  async publish(input: PublishInput, actor: Actor): Promise<{ tradeId: string; replayed: boolean }> {
    const replay = await this.replayedTradeId(input.idempotencyKey);
    if (replay) return { tradeId: replay, replayed: true };

    const { spec, entry, targets, stopLoss } = await this.validateSignal(input);
    if (!input.confirmDuplicate) {
      const duplicate = await this.findLikelyDuplicate(input, entry);
      if (duplicate) {
        // It may be our own twin: a parallel copy of this very request that committed first.
        const twin = await this.replayedTradeId(input.idempotencyKey);
        if (twin) return { tradeId: twin, replayed: true };
        throw new AppError(
          409,
          'DUPLICATE_SIGNAL',
          `${duplicate.ref} is still live with the same instrument, direction and entry. Publish anyway?`,
          { tradeId: duplicate.id, ref: duplicate.ref },
        );
      }
    }

    const settings = await this.settings.get();
    const entryExpiresAt = this.resolveExpiry(input.entryExpiresAt, settings.entryExpiryHoursDefault);
    const defaults = calculateLevels({ spec, direction: input.direction, entry });
    const usedDefaultLevels =
      defaults.stopLoss === stopLoss &&
      targets.length === defaultTargetPoints(spec).length &&
      defaults.targets.every((t, i) => t === targets[i]);

    try {
      const tradeId = await this.prisma.$transaction(async (tx) => {
        const template = await this.chooseSignalTemplate(tx, input);
        const [{ next } = { next: 0n }] = await tx.$queryRaw<
          { next: bigint }[]
        >`SELECT nextval('trade_ref_seq') AS next`;
        const ref = `T-${String(next).padStart(4, '0')}`;
        const targetState: TargetState[] = targets.map((price, i) => ({
          index: i + 1,
          price,
          originalPrice: price,
          status: 'OPEN',
          hitAt: null,
        }));
        const data = {
          ref,
          status: 'PUBLISHED' as const,
          instrumentId: input.instrumentId,
          instrumentSpec: spec as unknown as Prisma.InputJsonValue,
          direction: input.direction,
          entryType: input.entryType,
          entryLow: entry.low,
          entryHigh: entry.high,
          originalStopLoss: stopLoss,
          stopLoss,
          targets: targetState as unknown as Prisma.InputJsonValue,
          priority: input.priority,
          commentary: input.commentary || null,
          templateId: template.id,
          usedDefaultLevels,
          version: 1,
          draft: Prisma.DbNull,
          entryExpiresAt,
          publishedAt: new Date(),
        };
        let id: string;
        if (input.draftId) {
          const claimed = await tx.trade.updateMany({
            where: {
              id: input.draftId,
              status: 'DRAFT',
              ...(input.draftVersion !== undefined ? { version: input.draftVersion } : {}),
            },
            data,
          });
          if (claimed.count !== 1) {
            throw new AppError(
              409,
              'DRAFT_CHANGED',
              'This draft was changed or already published. Reopen it to continue.',
            );
          }
          id = input.draftId;
        } else {
          id = (await tx.trade.create({ data: { ...data, createdById: actor.id as string } })).id;
        }
        const context: TemplateContext = {
          ref,
          instrument: spec.symbol,
          direction: input.direction,
          entry: entryLabel(spec, entry),
          stop: formatPrice(spec, stopLoss),
          target1: targets[0] ? formatPrice(spec, targets[0]) : null,
          target2: targets[1] ? formatPrice(spec, targets[1]) : null,
          target3: targets[2] ? formatPrice(spec, targets[2]) : null,
          targets: targets.map((t) => formatPrice(spec, t)).join(', '),
          comment: input.commentary || null,
        };
        const rendered = this.templates.render(template, context);
        await this.events.append(tx, {
          tradeId: id,
          tradeVersion: 1,
          type: 'SIGNAL_PUBLISHED',
          broadcast: true,
          priority: input.priority,
          tone: template.tone,
          title: rendered.title,
          body: rendered.body,
          templateId: template.id,
          actorId: actor.id,
          idempotencyKey: input.idempotencyKey,
          payload: {
            ref,
            symbol: spec.symbol,
            direction: input.direction,
            pricePrecision: spec.pricePrecision,
            entryType: input.entryType,
            entryLow: entry.low,
            entryHigh: entry.high,
            priority: input.priority,
            comment: input.commentary || null,
            after: {
              status: 'PUBLISHED',
              stopLoss,
              targets: targetState.map(({ index, price, status }) => ({ index, price, status })),
              closedFraction: '0',
            },
          },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            action: 'SIGNAL_PUBLISHED',
            targetType: 'trade',
            targetId: id,
            metadata: {
              ref,
              symbol: spec.symbol,
              direction: input.direction,
              entry,
              targets,
              stopLoss,
              usedDefaultLevels,
            },
            requestId: actor.requestId,
          },
          tx,
        );
        return id;
      }, TX_OPTIONS);
      return { tradeId, replayed: false };
    } catch (error) {
      const couldBeTwin =
        isUniqueViolation(error, 'idempotency_key') || (error instanceof AppError && error.code === 'DRAFT_CHANGED');
      if (couldBeTwin) {
        const again = await this.replayedTradeId(input.idempotencyKey);
        if (again) return { tradeId: again, replayed: true };
      }
      throw error;
    }
  }

  private resolveExpiry(requested: string | null | undefined, defaultHours: number): Date | null {
    if (requested) {
      const at = new Date(requested);
      if (at.getTime() <= Date.now()) {
        throw new AppError(422, 'VALIDATION', 'The entry deadline must be in the future.');
      }
      return at;
    }
    if (requested === null) return null;
    return defaultHours > 0 ? new Date(Date.now() + defaultHours * 3_600_000) : null;
  }

  private async chooseSignalTemplate(tx: Tx, input: PublishInput) {
    const defaultKind: TemplateKind =
      input.priority === 'PRIORITY' ? 'PRIORITY_SIGNAL' : input.direction === 'BUY' ? 'BUY_STANDARD' : 'SELL_STANDARD';
    if (!input.templateId) return this.templates.resolve(defaultKind, tx);
    const chosen = await tx.signalTemplate.findFirst({ where: { id: input.templateId, active: true } });
    if (!chosen || !SIGNAL_KINDS.includes(chosen.kind as TemplateKind)) {
      throw new AppError(422, 'TEMPLATE_NOT_USABLE', 'That template is not available for new signals.');
    }
    const wrongSide =
      (chosen.kind === 'BUY_STANDARD' && input.direction !== 'BUY') ||
      (chosen.kind === 'SELL_STANDARD' && input.direction !== 'SELL');
    if (wrongSide) {
      throw new AppError(422, 'TEMPLATE_MISMATCH', `"${chosen.name}" is written for the opposite direction.`);
    }
    return chosen;
  }

  async execute(tradeId: string, command: TradeCommand, actor: Actor): Promise<{ tradeId: string; replayed: boolean }> {
    const replay = await this.replayedTradeId(command.idempotencyKey, tradeId);
    if (replay) return { tradeId: replay, replayed: true };
    try {
      const replayed = await this.prisma.$transaction(async (tx) => {
        // Row lock: a second administrator waits here, then fails the version check instead of overwriting.
        const locked = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM trades WHERE id = ${tradeId}::uuid FOR UPDATE`;
        if (locked.length === 0) throw notFound('Trade not found');
        // Checked again under the lock: a parallel copy of this same request may have just committed.
        const twin = await tx.signalEvent.findUnique({
          where: { idempotencyKey: command.idempotencyKey },
          select: { id: true },
        });
        if (twin) return true;
        const row = await tx.trade.findUniqueOrThrow({ where: { id: tradeId }, include: { closures: true } });
        if (row.status === 'DRAFT') throw new DomainError('INVALID_TRANSITION', 'Publish this draft first.');

        const state = toTradeState(row);
        const decision = decide(state, command, new Date());

        let version = state.version;
        let firstEventId: string | null = null;
        let lastEventId = '';
        for (const [i, event] of decision.events.entries()) {
          version += 1;
          const template = event.templateKind ? await this.templates.resolve(event.templateKind, tx) : null;
          const rendered = template
            ? this.templates.render(template, event.templateContext)
            : { title: 'Execution recorded (internal)', body: '' };
          const appended = await this.events.append(tx, {
            tradeId,
            tradeVersion: version,
            type: event.type,
            broadcast: event.broadcast,
            priority: event.type === 'URGENT_INSTRUCTION' ? 'PRIORITY' : row.priority,
            tone: template?.tone ?? 'NEUTRAL',
            title: rendered.title,
            body: rendered.body,
            payload: event.payload,
            templateId: template?.id ?? null,
            actorId: actor.id,
            idempotencyKey: i === 0 ? command.idempotencyKey : `${command.idempotencyKey}:${i}`,
          });
          firstEventId ??= appended.id;
          lastEventId = appended.id;
          if (event.type === 'EXECUTION_RECORDED' && decision.execution) {
            await tx.tradeExecutionRecord.create({
              data: {
                tradeId,
                eventId: appended.id,
                basis: decision.execution.basis,
                entryPrice: decision.execution.entryPrice,
                quantity: decision.execution.quantity,
                recordedById: actor.id as string,
              },
            });
          }
        }
        if (decision.closure) await this.persistClosure(tx, tradeId, lastEventId, decision.closure);

        const next = decision.next;
        await tx.trade.update({
          where: { id: tradeId },
          data: {
            status: next.status,
            version: next.version,
            entryLow: next.entry.low,
            entryHigh: next.entry.high,
            stopLoss: next.stopLoss,
            targets: next.targets as unknown as Prisma.InputJsonValue,
            closedFraction: next.closedFraction,
            closureBasis: next.closureBasis,
            executionEntry: next.execution?.entryPrice ?? null,
            executionQuantity: next.execution?.quantity ?? null,
            activatedAt: next.activatedAt ? new Date(next.activatedAt) : null,
            closedAt: next.closedAt ? new Date(next.closedAt) : null,
          },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            action: `TRADE_${command.action}`,
            targetType: 'trade',
            targetId: tradeId,
            metadata: {
              ref: state.ref,
              fromStatus: state.status,
              toStatus: next.status,
              version: next.version,
              before: snapshot(state),
              after: snapshot(next),
            } as unknown as Prisma.InputJsonValue,
            requestId: actor.requestId,
          },
          tx,
        );
        return false;
      }, TX_OPTIONS);
      return { tradeId, replayed };
    } catch (error) {
      if (isUniqueViolation(error, 'idempotency_key')) {
        const again = await this.replayedTradeId(command.idempotencyKey, tradeId);
        if (again) return { tradeId: again, replayed: true };
      }
      throw error;
    }
  }

  private async persistClosure(tx: Tx, tradeId: string, eventId: string, closure: NewClosure): Promise<void> {
    const created = await tx.tradeClosure.create({
      data: {
        tradeId,
        eventId,
        kind: closure.kind,
        fraction: closure.fraction,
        quantity: closure.quantity,
        exitPrice: closure.exitPrice,
        exitedAt: new Date(closure.exitedAt),
        reason: closure.reason,
        basis: closure.basis,
        entryPriceUsed: closure.entryPriceUsed,
        multiplierUsed: closure.multiplierUsed,
        fees: closure.fees,
        priceMove: closure.priceMove,
        points: closure.points,
        grossPnl: closure.grossPnl,
        netPnl: closure.netPnl,
        methodologyVersion: closure.methodologyVersion,
        supersedesId: closure.supersedesClosureId ?? null,
      },
    });
    if (closure.supersedesClosureId) {
      await tx.tradeClosure.update({
        where: { id: closure.supersedesClosureId },
        data: { supersededByEventId: eventId },
      });
      log('info', 'closure_superseded', { tradeId, closureId: created.id });
    }
  }

  /* ---------- Drafts ---------- */

  async createDraft(input: DraftInput, actor: Actor) {
    const row = await this.prisma.trade.create({
      data: { status: 'DRAFT', createdById: actor.id as string, draft: input as Prisma.InputJsonValue, version: 1 },
    });
    await this.audit.record({
      actorId: actor.id,
      action: 'DRAFT_CREATED',
      targetType: 'trade',
      targetId: row.id,
      requestId: actor.requestId,
    });
    return { id: row.id, version: row.version, draft: row.draft, updatedAt: row.updatedAt.toISOString() };
  }

  async updateDraft(id: string, input: DraftInput, actor: Actor) {
    const claimed = await this.prisma.trade.updateMany({
      where: { id, status: 'DRAFT' },
      data: { draft: input as Prisma.InputJsonValue, version: { increment: 1 } },
    });
    if (claimed.count !== 1) throw notFound('Draft not found');
    const row = await this.prisma.trade.findUniqueOrThrow({ where: { id } });
    await this.audit.record({
      actorId: actor.id,
      action: 'DRAFT_UPDATED',
      targetType: 'trade',
      targetId: id,
      requestId: actor.requestId,
    });
    return { id: row.id, version: row.version, draft: row.draft, updatedAt: row.updatedAt.toISOString() };
  }

  /** Drafts were never sent to anyone, so removal is allowed. Published trades can never be deleted. */
  async deleteDraft(id: string, actor: Actor) {
    const removed = await this.prisma.trade.deleteMany({ where: { id, status: 'DRAFT' } });
    if (removed.count !== 1) throw notFound('Draft not found');
    await this.audit.record({
      actorId: actor.id,
      action: 'DRAFT_DELETED',
      targetType: 'trade',
      targetId: id,
      requestId: actor.requestId,
    });
  }

  async listDrafts() {
    const rows = await this.prisma.trade.findMany({
      where: { status: 'DRAFT' },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    return rows.map((r) => ({ id: r.id, version: r.version, draft: r.draft, updatedAt: r.updatedAt.toISOString() }));
  }

  /** Closes out signals whose entry deadline passed unfilled. Called by the worker's sweeper. */
  async expireDue(now = new Date()): Promise<number> {
    const due = await this.prisma.trade.findMany({
      where: { status: 'PUBLISHED', entryExpiresAt: { lte: now } },
      select: { id: true, version: true },
      take: 50,
    });
    let expired = 0;
    for (const trade of due) {
      try {
        await this.execute(
          trade.id,
          {
            action: 'EXPIRE',
            expectedVersion: trade.version,
            idempotencyKey: crypto.randomUUID(),
            comment: 'Entry deadline passed.',
          },
          { id: null },
        );
        expired += 1;
      } catch (error) {
        // Another worker or an administrator got there first, which is fine.
        if (!(error instanceof DomainError)) throw error;
      }
    }
    return expired;
  }

  async publishAnnouncement(
    input: { title?: string; message: string; priority: 'NORMAL' | 'PRIORITY'; idempotencyKey: string },
    actor: Actor,
  ) {
    const existing = await this.prisma.signalEvent.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return { eventId: existing.id, replayed: true };
    try {
      const eventId = await this.prisma.$transaction(async (tx) => {
        const template = await this.templates.resolve('MARKET_UPDATE', tx);
        const rendered = this.templates.render(template, { message: input.message });
        const event = await this.events.append(tx, {
          tradeId: null,
          tradeVersion: null,
          type: 'ANNOUNCEMENT',
          broadcast: true,
          priority: input.priority,
          tone: template.tone,
          title: input.title || rendered.title,
          body: rendered.body,
          templateId: template.id,
          actorId: actor.id,
          idempotencyKey: input.idempotencyKey,
          payload: { title: input.title || undefined, message: input.message, priority: input.priority },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            action: 'ANNOUNCEMENT_PUBLISHED',
            targetType: 'event',
            targetId: event.id,
            requestId: actor.requestId,
          },
          tx,
        );
        return event.id;
      }, TX_OPTIONS);
      return { eventId, replayed: false };
    } catch (error) {
      if (isUniqueViolation(error, 'idempotency_key')) {
        const again = await this.prisma.signalEvent.findUniqueOrThrow({
          where: { idempotencyKey: input.idempotencyKey },
        });
        return { eventId: again.id, replayed: true };
      }
      throw error;
    }
  }
}
