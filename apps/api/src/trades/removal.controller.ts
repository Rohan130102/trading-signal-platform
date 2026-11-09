import { Controller, HttpCode, Post } from '@nestjs/common';
import { removeTradesSchema, restoreRemovedTradesSchema } from '@signaldesk/domain';
import type { z } from 'zod';
import { AdminOnly, Auth, type AuthContext, MasterOnly, RequestId, Summary, ZBody } from '../common/http.js';
import { TradeRemovalService } from './removal.service.js';

@Controller('admin/trade-removals')
@AdminOnly()
@MasterOnly()
export class TradeRemovalController {
  constructor(private readonly removals: TradeRemovalService) {}

  @Post()
  @HttpCode(200)
  @Summary(
    'Take finished trades off every subscriber screen. All or nothing; reason and typed confirmation required. ' +
      'Nothing is deleted and performance figures keep counting them. Master Admin only.',
  )
  remove(
    @Auth() auth: AuthContext,
    @RequestId() requestId: string,
    @ZBody(removeTradesSchema) body: z.infer<typeof removeTradesSchema>,
  ) {
    return this.removals.remove(body.tradeIds, body.expectedCount, body.reason, { id: auth.user.id, requestId });
  }

  @Post('restore')
  @HttpCode(200)
  @Summary('Put removed trades back on subscriber screens. Master Admin only.')
  restore(
    @Auth() auth: AuthContext,
    @RequestId() requestId: string,
    @ZBody(restoreRemovedTradesSchema) body: z.infer<typeof restoreRemovedTradesSchema>,
  ) {
    return this.removals.restore(body.tradeIds, { id: auth.user.id, requestId });
  }
}
