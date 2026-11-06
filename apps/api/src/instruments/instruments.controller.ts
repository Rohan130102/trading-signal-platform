import { Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
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

function present(row: Prisma.InstrumentGetPayload<object>) {
  return { id: row.id, active: row.active, sortOrder: row.sortOrder, ...instrumentToSpec(row) };
}

@Controller()
export class InstrumentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('instruments/symbols')
  @RequireSignalAccess()
  @Summary('Symbols available as a history filter')
  async symbols() {
    const rows = await this.prisma.instrument.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { symbol: true, displayName: true },
    });
    return { symbols: rows };
  }

  @Get('admin/instruments')
  @AdminOnly()
  @Summary('List instruments with full configuration')
  async list() {
    const rows = await this.prisma.instrument.findMany({ orderBy: [{ sortOrder: 'asc' }, { symbol: 'asc' }] });
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
      const row = await this.prisma.instrument.create({ data: body });
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
    try {
      const row = await this.prisma.instrument.update({ where: { id }, data: body });
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
}
