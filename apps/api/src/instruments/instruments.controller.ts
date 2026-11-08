import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import {
  type InstrumentInput,
  instrumentSchema,
  type InstrumentSpec,
  validateInstrumentSpec,
} from '@signaldesk/domain';
import {
  AdminOnly,
  AppError,
  Auth,
  type AuthContext,
  notFound,
  RequestId,
  RequireSignalAccess,
  Summary,
  ZBody,
} from '../common/http.js';
import { isUniqueViolation, Prisma, PrismaService } from '../db/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { instrumentToSpec } from '../trades/mappers.js';

function assertValid(input: InstrumentInput): void {
  const spec: InstrumentSpec = {
    ...input,
    defaultTarget2Points: input.defaultTarget2Points,
    defaultTarget3Points: input.defaultTarget3Points,
    contractMultiplier: input.contractMultiplier,
  };
  const issues = validateInstrumentSpec(spec);
  if (issues.length > 0) throw new AppError(422, 'VALIDATION', issues[0]?.message ?? 'Invalid instrument', { issues });
}

const PUBLISHED_TRADES = { _count: { select: { trades: { where: { status: { not: 'DRAFT' as const } } } } } };

function present(row: Prisma.InstrumentGetPayload<object> & { _count?: { trades: number } }) {
  return {
    id: row.id,
    active: row.active,
    sortOrder: row.sortOrder,
    exchange: row.exchange,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    tradeCount: row._count?.trades ?? 0,
    ...instrumentToSpec(row),
  };
}

@Controller()
export class InstrumentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('instruments/symbols')
  @RequireSignalAccess()
  @Summary('Instruments for the filters: every current one, and archived ones that still have trades')
  async symbols() {
    const rows = await this.prisma.instrument.findMany({
      where: { OR: [{ archivedAt: null }, { trades: { some: { status: { not: 'DRAFT' } } } }] },
      orderBy: [{ sortOrder: 'asc' }, { symbol: 'asc' }],
      select: { symbol: true, displayName: true, assetClass: true, exchange: true, archivedAt: true },
    });
    return {
      symbols: rows.map((r) => ({
        symbol: r.symbol,
        displayName: r.displayName,
        assetClass: r.assetClass,
        exchange: r.exchange,
        archived: r.archivedAt !== null,
      })),
    };
  }

  @Get('admin/instruments')
  @AdminOnly()
  @Summary('List instruments with full configuration')
  async list() {
    const rows = await this.prisma.instrument.findMany({
      orderBy: [{ sortOrder: 'asc' }, { symbol: 'asc' }],
      include: PUBLISHED_TRADES,
    });
    return { instruments: rows.map(present) };
  }

  @Post('admin/instruments')
  @AdminOnly()
  @Summary('Add an instrument without code changes')
  async create(
    @Auth() auth: AuthContext,
    @RequestId() requestId: string,
    @ZBody(instrumentSchema) body: InstrumentInput,
  ) {
    assertValid(body);
    try {
      const row = await this.prisma.instrument.create({ data: body, include: PUBLISHED_TRADES });
      await this.audit.record({
        actorId: auth.user.id,
        action: 'INSTRUMENT_CREATED',
        targetType: 'instrument',
        targetId: row.id,
        metadata: { symbol: row.symbol },
        requestId,
      });
      return present(row);
    } catch (error) {
      if (isUniqueViolation(error))
        throw new AppError(409, 'SYMBOL_EXISTS', 'An instrument with that symbol already exists.');
      throw error;
    }
  }

  @Put('admin/instruments/:id')
  @AdminOnly()
  @Summary('Edit an instrument. Trades already published keep the configuration they were published with.')
  async update(
    @Auth() auth: AuthContext,
    @RequestId() requestId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(instrumentSchema) body: InstrumentInput,
  ) {
    assertValid(body);
    const before = await this.prisma.instrument.findUnique({ where: { id } });
    if (!before) throw notFound('Instrument not found');
    if (before.archivedAt && body.active) {
      throw new AppError(409, 'INSTRUMENT_ARCHIVED', 'Restore this instrument before switching it on.');
    }
    try {
      const row = await this.prisma.instrument.update({ where: { id }, data: body, include: PUBLISHED_TRADES });
      await this.audit.record({
        actorId: auth.user.id,
        action: 'INSTRUMENT_UPDATED',
        targetType: 'instrument',
        targetId: id,
        metadata: { before: present(before), after: present(row) },
        requestId,
      });
      return present(row);
    } catch (error) {
      if (isUniqueViolation(error))
        throw new AppError(409, 'SYMBOL_EXISTS', 'An instrument with that symbol already exists.');
      throw error;
    }
  }

  /**
   * Retires an instrument: it disappears from the composer and from filters once it has no trades. Trades
   * already published keep the configuration they were published with, so nothing in history changes.
   */
  @Post('admin/instruments/:id/archive')
  @AdminOnly()
  @HttpCode(200)
  @Summary('Archive an instrument. Its trades and their history are untouched.')
  async archive(@Auth() auth: AuthContext, @RequestId() requestId: string, @Param('id', ParseUUIDPipe) id: string) {
    const row = await this.setArchived(id, true);
    await this.audit.record({
      actorId: auth.user.id,
      action: 'INSTRUMENT_ARCHIVED',
      targetType: 'instrument',
      targetId: id,
      metadata: { symbol: row.symbol },
      requestId,
    });
    return row;
  }

  @Post('admin/instruments/:id/restore')
  @AdminOnly()
  @HttpCode(200)
  @Summary('Bring an archived instrument back. It stays switched off until you switch it on.')
  async restore(@Auth() auth: AuthContext, @RequestId() requestId: string, @Param('id', ParseUUIDPipe) id: string) {
    const row = await this.setArchived(id, false);
    await this.audit.record({
      actorId: auth.user.id,
      action: 'INSTRUMENT_RESTORED',
      targetType: 'instrument',
      targetId: id,
      metadata: { symbol: row.symbol },
      requestId,
    });
    return row;
  }

  private async setArchived(id: string, archived: boolean) {
    const existing = await this.prisma.instrument.findUnique({ where: { id } });
    if (!existing) throw notFound('Instrument not found');
    const row = await this.prisma.instrument.update({
      where: { id },
      data: archived ? { archivedAt: existing.archivedAt ?? new Date(), active: false } : { archivedAt: null },
      include: PUBLISHED_TRADES,
    });
    return present(row);
  }
}
