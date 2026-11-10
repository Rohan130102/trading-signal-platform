import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { securityEventSchema } from '@signaldesk/domain';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { RateLimitService } from '../auth/rate-limit.service.js';
import { Auth, type AuthContext, Summary, ZBody } from '../common/http.js';
import { PrismaService } from '../db/prisma.service.js';
import { DevicesService } from '../devices/devices.service.js';

const SECURITY_EVENTS_PER_HOUR = 30;

@Controller('me')
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DevicesService,
    private readonly audit: AuditService,
    private readonly limits: RateLimitService,
  ) {}

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
