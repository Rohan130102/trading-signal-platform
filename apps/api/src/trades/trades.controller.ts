import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import {
  adminTradesQuery,
  draftSchema,
  feedQuery,
  historyQuery,
  markReadSchema,
  previewSignalSchema,
  publishSignalSchema,
  riskSummary,
  tradeCommandSchema,
  type TradeCommand,
} from '@signaldesk/domain';
import type { z } from 'zod';
import {
  AdminOnly,
  Auth,
  type AuthContext,
  RequestId,
  RequireSignalAccess,
  Summary,
  ZBody,
  ZQuery,
} from '../common/http.js';
import { TradesQueries } from './trades.queries.js';
import { TradesService } from './trades.service.js';

@Controller()
@RequireSignalAccess()
export class SubscriberTradesController {
  constructor(private readonly queries: TradesQueries) {}

  @Get('feed')
  @Summary('Chronological signal events. Use `after` to catch up, `before` to page back.')
  feed(@Auth() auth: AuthContext, @ZQuery(feedQuery) query: z.infer<typeof feedQuery>) {
    return this.queries.feed(auth.user.id, query);
  }

  @Post('feed/read')
  @HttpCode(200)
  @Summary('Move the read marker forward')
  async read(@Auth() auth: AuthContext, @ZBody(markReadSchema) body: z.infer<typeof markReadSchema>) {
    return { unread: await this.queries.markRead(auth.user.id, body.seq) };
  }

  @Get('trades/active')
  @Summary('Trades live right now, with their latest effective levels')
  async active() {
    return { trades: await this.queries.activeTrades() };
  }

  @Get('trades/history')
  @Summary('Searchable trade history')
  history(@Auth() auth: AuthContext, @ZQuery(historyQuery) query: z.infer<typeof historyQuery>) {
    // Subscribers never see the archive filter; it is an administrator's tool.
    return this.queries.history({ ...query, archived: 'ANY' }, auth.user.id);
  }

  @Get('trades/:id')
  @Summary('One trade with its full subscriber-visible timeline')
  detail(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.queries.subscriberDetail(id, auth.user.id);
  }
}

@Controller('admin')
@AdminOnly()
export class AdminTradesController {
  constructor(
    private readonly trades: TradesService,
    private readonly queries: TradesQueries,
  ) {}

  @Post('signals/preview')
  @HttpCode(200)
  @Summary('Server-side validation and risk geometry for the composer')
  async preview(@ZBody(previewSignalSchema) body: z.infer<typeof previewSignalSchema>) {
    const { spec, entry, targets, stopLoss } = await this.trades.validateSignal(body);
    return { valid: true, risk: riskSummary({ spec, direction: body.direction, entry, targets, stopLoss }) };
  }

  @Post('signals')
  @Summary('Publish a signal. The idempotency key makes repeats safe.')
  async publish(
    @Auth() auth: AuthContext,
    @RequestId() requestId: string,
    @ZBody(publishSignalSchema) body: z.infer<typeof publishSignalSchema>,
  ) {
    const result = await this.trades.publish(body, { id: auth.user.id, requestId });
    return { ...result, trade: await this.queries.adminDetail(result.tradeId) };
  }

  @Get('drafts')
  @Summary('List saved drafts')
  async drafts() {
    return { drafts: await this.trades.listDrafts() };
  }

  @Post('drafts')
  @Summary('Save a draft. Drafts may be incomplete.')
  createDraft(
    @Auth() auth: AuthContext,
    @RequestId() requestId: string,
    @ZBody(draftSchema) body: z.infer<typeof draftSchema>,
  ) {
    return this.trades.createDraft(body, { id: auth.user.id, requestId });
  }

  @Put('drafts/:id')
  @Summary('Update a draft')
  updateDraft(
    @Auth() auth: AuthContext,
    @RequestId() requestId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(draftSchema) body: z.infer<typeof draftSchema>,
  ) {
    return this.trades.updateDraft(id, body, { id: auth.user.id, requestId });
  }

  @Delete('drafts/:id')
  @HttpCode(200)
  @Summary('Discard a draft. Only unpublished signals can be removed.')
  async deleteDraft(@Auth() auth: AuthContext, @RequestId() requestId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.trades.deleteDraft(id, { id: auth.user.id, requestId });
    return { ok: true };
  }

  @Get('trades')
  @Summary('All published trades, including internal results')
  list(@ZQuery(adminTradesQuery) query: z.infer<typeof adminTradesQuery>) {
    return this.queries.adminList({ ...query, live: query.live === undefined ? undefined : query.live === 'true' });
  }

  @Get('trades/:id')
  @Summary('A trade with events, delivery status, exits and allowed actions')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.queries.adminDetail(id);
  }

  @Post('trades/:id/events')
  @Summary('Apply a lifecycle action. Stale versions are rejected.')
  async command(
    @Auth() auth: AuthContext,
    @RequestId() requestId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(tradeCommandSchema) body: TradeCommand,
  ) {
    const result = await this.trades.execute(id, body, { id: auth.user.id, requestId });
    return { replayed: result.replayed, trade: await this.queries.adminDetail(id) };
  }
}
