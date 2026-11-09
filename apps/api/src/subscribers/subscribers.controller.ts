import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import {
  accountActionSchema,
  adjustSubscriptionSchema,
  createSubscriberSchema,
  listSubscribersQuery,
  renewSubscriptionSchema,
  screenshotPermissionSchema,
  updateSubscriberSchema,
} from '@signaldesk/domain';
import type { z } from 'zod';
import { AdminOnly, Auth, type AuthContext, MasterOnly, RequestId, Summary, ZBody, ZQuery } from '../common/http.js';
import { SubscribersService } from './subscribers.service.js';

type AccountAction = z.infer<typeof accountActionSchema>;

@Controller('admin/subscribers')
@AdminOnly()
export class SubscribersController {
  constructor(private readonly subscribers: SubscribersService) {}

  @Get()
  @Summary('Search and filter subscribers')
  list(@ZQuery(listSubscribersQuery) query: z.infer<typeof listSubscribersQuery>) {
    return this.subscribers.list(query);
  }

  @Post()
  @Summary('Create a subscriber. The temporary password is returned once.')
  create(
    @Auth() auth: AuthContext,
    @RequestId() requestId: string,
    @ZBody(createSubscriberSchema) body: z.infer<typeof createSubscriberSchema>,
  ) {
    return this.subscribers.create(body, { id: auth.user.id, requestId });
  }

  @Get(':id')
  @Summary('Subscriber detail with subscription history')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.subscribers.detail(id);
  }

  @Put(':id')
  @Summary('Edit contact details and notes')
  update(
    @Auth() auth: AuthContext,
    @RequestId() requestId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(updateSubscriberSchema) body: z.infer<typeof updateSubscriberSchema>,
  ) {
    return this.subscribers.update(id, body, { id: auth.user.id, requestId });
  }

  @Put(':id/screenshots')
  @MasterOnly()
  @Summary('Allow or block screenshots for this subscriber, or follow the platform default. Master Admin only.')
  setScreenshots(
    @Auth() auth: AuthContext,
    @RequestId() requestId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(screenshotPermissionSchema) body: z.infer<typeof screenshotPermissionSchema>,
  ) {
    return this.subscribers.setScreenshotPermission(id, body.screenshotsAllowed, { id: auth.user.id, requestId });
  }

  @Post(':id/renew')
  @Summary('Renew: extends from expiry if active, restarts from now if expired')
  renew(
    @Auth() auth: AuthContext,
    @RequestId() requestId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(renewSubscriptionSchema) body: z.infer<typeof renewSubscriptionSchema>,
  ) {
    return this.subscribers.renew(id, body, { id: auth.user.id, requestId });
  }

  @Post(':id/adjust')
  @Summary('Set subscription dates directly, with a recorded reason')
  adjust(
    @Auth() auth: AuthContext,
    @RequestId() requestId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(adjustSubscriptionSchema) body: z.infer<typeof adjustSubscriptionSchema>,
  ) {
    return this.subscribers.adjust(id, body, { id: auth.user.id, requestId });
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @Summary('Suspend the account and end its sessions at once')
  suspend(
    @Auth() auth: AuthContext,
    @RequestId() requestId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(accountActionSchema) body: AccountAction,
  ) {
    return this.subscribers.setStatus(id, 'SUSPENDED', body.note, { id: auth.user.id, requestId });
  }

  @Post(':id/disable')
  @HttpCode(200)
  @Summary('Disable the account and end its sessions at once')
  disable(
    @Auth() auth: AuthContext,
    @RequestId() requestId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(accountActionSchema) body: AccountAction,
  ) {
    return this.subscribers.setStatus(id, 'DISABLED', body.note, { id: auth.user.id, requestId });
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @Summary('Reactivate a suspended or disabled account')
  reactivate(
    @Auth() auth: AuthContext,
    @RequestId() requestId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(accountActionSchema) body: AccountAction,
  ) {
    return this.subscribers.setStatus(id, 'ACTIVE', body.note, { id: auth.user.id, requestId });
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  @Summary('Issue a new temporary password. Ends all sessions.')
  reset(@Auth() auth: AuthContext, @RequestId() requestId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.subscribers.resetPassword(id, { id: auth.user.id, requestId });
  }

  @Post(':id/revoke-sessions')
  @HttpCode(200)
  @Summary('Sign the subscriber out everywhere')
  revoke(@Auth() auth: AuthContext, @RequestId() requestId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.subscribers.revokeSessions(id, { id: auth.user.id, requestId });
  }
}
