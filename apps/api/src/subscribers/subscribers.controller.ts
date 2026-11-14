import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import {
  accountActionSchema,
  adjustSubscriptionSchema,
  createSubscriberSchema,
  enquiryStatusSchema,
  grantTrialSchema,
  listRegistrationsQuery,
  listSubscribersQuery,
  passwordResetsQuery,
  renewSubscriptionSchema,
  screenshotPermissionSchema,
  startSubscriptionSchema,
  updateSubscriberSchema,
} from '@signaldesk/domain';
import type { z } from 'zod';
import { AdminOnly, Auth, type AuthContext, MasterOnly, RequestId, Summary, ZBody, ZQuery } from '../common/http.js';
import { PrismaService } from '../db/prisma.service.js';
import { EnquiriesService } from '../enquiries/enquiries.service.js';
import { PasswordResetsService } from '../registration/password-resets.service.js';
import { SubscribersService } from './subscribers.service.js';

type AccountAction = z.infer<typeof accountActionSchema>;

@Controller('admin/subscribers')
@AdminOnly()
export class SubscribersController {
  constructor(
    private readonly subscribers: SubscribersService,
    private readonly enquiries: EnquiriesService,
  ) {}

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

  @Post(':id/start')
  @Summary('Start a paid subscription for any number of days: for no access, an expired one, or a running trial')
  start(
    @Auth() auth: AuthContext,
    @RequestId() requestId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(startSubscriptionSchema) body: z.output<typeof startSubscriptionSchema>,
  ) {
    return this.subscribers.start(id, body, { id: auth.user.id, requestId });
  }

  @Post(':id/trial')
  @Summary('Grant a free trial for any number of days. Never automatic; a second trial needs allowRepeat.')
  trial(
    @Auth() auth: AuthContext,
    @RequestId() requestId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(grantTrialSchema) body: z.output<typeof grantTrialSchema>,
  ) {
    return this.subscribers.grantTrial(id, body, { id: auth.user.id, requestId });
  }

  @Put(':id/enquiry')
  @Summary('Move a subscription enquiry along: started, under discussion, resolved')
  async enquiry(
    @Auth() auth: AuthContext,
    @RequestId() requestId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(enquiryStatusSchema) body: z.output<typeof enquiryStatusSchema>,
  ) {
    await this.enquiries.setStatus(id, body.status, { id: auth.user.id, requestId });
    return this.subscribers.detail(id);
  }

  @Post(':id/seen')
  @HttpCode(200)
  @Summary('Take a new registration off the badge')
  seen(@Param('id', ParseUUIDPipe) id: string) {
    return this.subscribers.markSeen(id);
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

@Controller('admin')
@AdminOnly()
export class RegistrationsAdminController {
  constructor(
    private readonly subscribers: SubscribersService,
    private readonly resets: PasswordResetsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('registrations')
  @Summary('People who signed themselves up, newest first, with search and filters')
  registrations(@ZQuery(listRegistrationsQuery) query: z.output<typeof listRegistrationsQuery>) {
    return this.subscribers.registrations(query);
  }

  @Get('inbox')
  @Summary('Counts for the administrator badges: unseen registrations and open password resets')
  async inbox() {
    const [newRegistrations, openPasswordResets] = await Promise.all([
      this.prisma.user.count({
        where: { role: 'SUBSCRIBER', selfRegisteredAt: { not: null }, registrationSeenAt: null },
      }),
      this.prisma.passwordResetRequest.count({ where: { status: 'OPEN' } }),
    ]);
    return { newRegistrations, openPasswordResets };
  }

  @Get('password-resets')
  @Summary('Password reset requests from people who proved their email address')
  passwordResets(@ZQuery(passwordResetsQuery) query: z.output<typeof passwordResetsQuery>) {
    return this.resets.list(query.status);
  }

  @Post('password-resets/:id/issue')
  @HttpCode(200)
  @Summary('Issue a temporary password, shown this once. Signs them out everywhere; they must replace it.')
  issue(@Auth() auth: AuthContext, @RequestId() requestId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.resets.issue(id, { id: auth.user.id, requestId });
  }

  @Post('password-resets/:id/complete')
  @HttpCode(200)
  @Summary('Mark a request as done')
  complete(@Auth() auth: AuthContext, @RequestId() requestId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.resets.close(id, 'COMPLETED', { id: auth.user.id, requestId });
  }

  @Post('password-resets/:id/dismiss')
  @HttpCode(200)
  @Summary('Close a request without issuing a password')
  dismiss(@Auth() auth: AuthContext, @RequestId() requestId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.resets.close(id, 'DISMISSED', { id: auth.user.id, requestId });
  }
}
