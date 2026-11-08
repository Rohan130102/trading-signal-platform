import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { archiveBeforeSchema, archiveTradesSchema, unarchiveTradesSchema } from '@signaldesk/domain';
import { z } from 'zod';
import { AdminOnly, Auth, type AuthContext, RequestId, Summary, ZBody, ZQuery } from '../common/http.js';
import { TradeArchiveService } from './archive.service.js';

const previewQuery = z.object({ before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD') });

@Controller('admin/trade-archive')
@AdminOnly()
export class TradeArchiveController {
  constructor(private readonly archive: TradeArchiveService) {}

  @Get('preview')
  @Summary('How many finished trades closed before a date and are not archived yet')
  preview(@ZQuery(previewQuery) query: z.infer<typeof previewQuery>) {
    return this.archive.preview(query.before);
  }

  @Post()
  @HttpCode(200)
  @Summary('Archive selected finished trades. All or nothing; the confirmed count must match.')
  archiveSelected(
    @Auth() auth: AuthContext,
    @RequestId() requestId: string,
    @ZBody(archiveTradesSchema) body: z.infer<typeof archiveTradesSchema>,
  ) {
    return this.archive.archive(body.tradeIds, body.expectedCount, body.reason, { id: auth.user.id, requestId });
  }

  @Post('before')
  @HttpCode(200)
  @Summary('Archive every finished trade closed before a date. The confirmed count must match.')
  archiveBefore(
    @Auth() auth: AuthContext,
    @RequestId() requestId: string,
    @ZBody(archiveBeforeSchema) body: z.infer<typeof archiveBeforeSchema>,
  ) {
    return this.archive.archiveBefore(body.before, body.expectedCount, body.reason, { id: auth.user.id, requestId });
  }

  @Post('restore')
  @HttpCode(200)
  @Summary('Put archived trades back in the Signals list')
  restore(
    @Auth() auth: AuthContext,
    @RequestId() requestId: string,
    @ZBody(unarchiveTradesSchema) body: z.infer<typeof unarchiveTradesSchema>,
  ) {
    return this.archive.unarchive(body.tradeIds, { id: auth.user.id, requestId });
  }
}
