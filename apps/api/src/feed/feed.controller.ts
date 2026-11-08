import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  HIDDEN_ITEM_TYPES,
  type HiddenItemType,
  hideItemSchema,
  markNotificationsReadSchema,
  notificationsQuerySchema,
  signalsQuerySchema,
} from '@signaldesk/domain';
import { z } from 'zod';
import { Auth, type AuthContext, RequireSignalAccess, Summary, ZBody, ZodPipe, ZQuery } from '../common/http.js';
import { TradesQueries } from '../trades/trades.queries.js';
import { FeedService } from './feed.service.js';

@Controller()
@RequireSignalAccess()
export class FeedController {
  constructor(
    private readonly feed: FeedService,
    private readonly trades: TradesQueries,
  ) {}

  @Get('signals')
  @Summary('Trades with their latest updates, newest activity first. Hidden and archived trades are left out.')
  signals(@Auth() auth: AuthContext, @ZQuery(signalsQuerySchema) query: z.infer<typeof signalsQuerySchema>) {
    return this.feed.signals(auth.user.id, query);
  }

  @Get('notifications')
  @Summary('Every alert, newest first, with this person’s read state')
  notifications(
    @Auth() auth: AuthContext,
    @ZQuery(notificationsQuerySchema) query: z.infer<typeof notificationsQuerySchema>,
  ) {
    return this.feed.notifications(auth.user.id, query);
  }

  @Post('notifications/read')
  @HttpCode(200)
  @Summary('Mark everything, some alerts, or one trade’s alerts as read')
  async markRead(
    @Auth() auth: AuthContext,
    @ZBody(markNotificationsReadSchema) body: z.infer<typeof markNotificationsReadSchema>,
  ) {
    if ('all' in body) {
      await this.trades.markRead(auth.user.id, body.upToSeq);
      return { unread: await this.feed.unreadCount(auth.user.id) };
    }
    const where = 'eventIds' in body ? { id: { in: body.eventIds } } : { tradeId: body.tradeId };
    return { unread: await this.feed.markEventsRead(auth.user.id, where) };
  }

  @Post('me/hidden')
  @HttpCode(200)
  @Summary('Hide a trade or announcement from your own lists. Nobody else is affected and nothing is deleted.')
  async hide(@Auth() auth: AuthContext, @ZBody(hideItemSchema) body: z.infer<typeof hideItemSchema>) {
    await this.feed.hide(auth.user.id, body.type, body.id);
    return { hidden: true };
  }

  @Delete('me/hidden/:type/:id')
  @HttpCode(200)
  @Summary('Show a hidden item again')
  async unhide(
    @Auth() auth: AuthContext,
    @Param('type', new ZodPipe(z.enum(HIDDEN_ITEM_TYPES))) type: HiddenItemType,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.feed.unhide(auth.user.id, type, id);
    return { hidden: false };
  }
}
