import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { enquirySchema, securityEventSchema } from '@signaldesk/domain';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { RateLimitService } from '../auth/rate-limit.service.js';
import { Auth, type AuthContext, Summary, ZBody } from '../common/http.js';
import { PrismaService } from '../db/prisma.service.js';
import { DevicesService } from '../devices/devices.service.js';
import { AppError } from '../common/http.js';
import { EnquiriesService } from '../enquiries/enquiries.service.js';
import { NoticesService } from '../notices/notices.service.js';

const SECURITY_EVENTS_PER_HOUR = 30;

@Controller('me')
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DevicesService,
    private readonly audit: AuditService,
    private readonly limits: RateLimitService,
    private readonly enquiries: EnquiriesService,
    private readonly notices: NoticesService,
  ) {}

  @Post('enquiries')
  @HttpCode(200)
  @Summary('Send a subscription enquiry. WhatsApp is recorded as a link opened, email as queued until accepted.')
  enquire(@Auth() auth: AuthContext, @ZBody(enquirySchema) body: z.output<typeof enquirySchema>) {
    return this.enquiries.create(auth.user.id, body);
  }

  @Get('enquiries/:id')
  @Summary('Where an enquiry stands, for example whether the email provider accepted it')
  enquiry(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.enquiries.get(auth.user.id, id);
  }

  @Get('notices')
  @Summary('Messages about your own account, such as a subscription starting')
  async noticesList(@Auth() auth: AuthContext) {
    return { notices: await this.notices.list(auth.user.id) };
  }

  @Post('notices/read')
  @HttpCode(200)
  @Summary('Mark your account messages as read')
  async noticesRead(@Auth() auth: AuthContext) {
    return { marked: await this.notices.markRead(auth.user.id) };
  }

  @Post('trial-greeting/:grantId')
  @HttpCode(200)
  @Summary('Record that the trial welcome was shown, so no device shows it again')
  async trialGreeting(@Auth() auth: AuthContext, @Param('grantId', ParseUUIDPipe) grantId: string) {
    const result = await this.prisma.trialGrant.updateMany({
      where: { id: grantId, userId: auth.user.id, acknowledgedAt: null },
      data: { acknowledgedAt: new Date() },
    });
    if (result.count === 0) {
      const exists = await this.prisma.trialGrant.count({ where: { id: grantId, userId: auth.user.id } });
      if (!exists) throw new AppError(404, 'NOT_FOUND', 'Trial not found');
    }
    return { ok: true };
  }

  @Get('device')
  @Summary('This installation, if it is registered to the signed-in subscriber')
  async device(@Auth() auth: AuthContext) {
    return { device: await this.devices.currentFor(auth.user.id, auth.installationId) };
  }

  @Post('onboarding')
  @HttpCode(200)
  @Summary('Record that the first-use tour was finished or skipped, so it is not shown again')
  async onboarded(@Auth() auth: AuthContext) {
    const row = await this.prisma.user.update({
      where: { id: auth.user.id },
      data: { onboardedAt: auth.user.onboardedAt ?? new Date() },
      select: { onboardedAt: true },
    });
    return { onboardedAt: row.onboardedAt?.toISOString() ?? null };
  }

  /**
   * The phone reports a screenshot or recording it observed (iPhone only: Android blocks them outright).
   * Only the fact, the screen and the time are kept. Capped, so a stuck client cannot flood the audit log.
   */
  @Post('security-events')
  @HttpCode(200)
  @Summary('Record a screen capture the app observed')
  async securityEvent(
    @Auth() auth: AuthContext,
    @ZBody(securityEventSchema) body: z.infer<typeof securityEventSchema>,
  ) {
    const key = `capture:${auth.user.id}`;
    if ((await this.limits.count(key, 3600)) >= SECURITY_EVENTS_PER_HOUR) return { recorded: false };
    await this.limits.hit(key, 3600);
    await this.audit.record({
      actorId: auth.user.id,
      action: body.type === 'SCREENSHOT' ? 'SCREENSHOT_DETECTED' : 'SCREEN_RECORDING_DETECTED',
      targetType: 'user',
      targetId: auth.user.id,
      metadata: { screen: body.screen ?? null },
    });
    return { recorded: true };
  }
}
