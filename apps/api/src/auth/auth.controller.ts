import { Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import {
  changePasswordSchema,
  daysRemaining,
  type EnquiryStatus,
  type SubscriptionKind,
  trialToGreet,
  lastValidLocalDate,
  loginSchema,
  mfaCodeSchema,
  type MeResponse,
  screenshotsAllowedFor,
  subscriptionState,
  tokenLoginSchema,
  type TokenLoginResponse,
} from '@signaldesk/domain';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { AllowIncompleteSession, Auth, type AuthContext, ClientIp, Public, Summary, ZBody } from '../common/http.js';
import { isProduction } from '../config/env.js';
import { PrismaService } from '../db/prisma.service.js';
import { splitName } from '../enquiries/enquiries.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { AuthService } from './auth.service.js';
import { SESSION_COOKIE } from './session.guard.js';

function deviceLabel(req: Request): string | undefined {
  return req.headers['user-agent']?.slice(0, 120);
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('login')
  @Public()
  @HttpCode(200)
  @Summary('Sign in with a login ID and password')
  async login(
    @ZBody(loginSchema) body: z.infer<typeof loginSchema>,
    @ClientIp() ip: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, ttlMs } = await this.auth.login(body.identifier, body.password, ip, deviceLabel(req));
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: ttlMs,
    });
    return { ok: true };
  }

  @Post('token')
  @Public()
  @HttpCode(200)
  @Summary('Sign in from a native app. Returns a bearer token, once, for secure device storage.')
  async nativeLogin(
    @ZBody(tokenLoginSchema) body: z.infer<typeof tokenLoginSchema>,
    @ClientIp() ip: string,
  ): Promise<TokenLoginResponse> {
    const { token, ttlMs } = await this.auth.login(body.identifier, body.password, ip, body.deviceLabel, {
      installationId: body.installationId,
      platform: body.platform,
    });
    return { token, expiresAt: new Date(Date.now() + ttlMs).toISOString() };
  }

  @Post('logout')
  @AllowIncompleteSession()
  @HttpCode(200)
  @Summary('Sign out of this device')
  async logout(@Auth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(auth.sessionId, auth.user.id);
    res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure: isProduction, sameSite: 'lax' });
    return { ok: true };
  }

  @Post('logout-all')
  @HttpCode(200)
  @Summary('Sign out of every device, including this one')
  async logoutAll(@Auth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    await this.auth.revokeAllSessions(auth.user.id);
    res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure: isProduction, sameSite: 'lax' });
    return { ok: true };
  }

  @Get('me')
  @AllowIncompleteSession()
  @Summary('The signed-in user, their access state and any required next step')
  async me(@Auth() auth: AuthContext): Promise<MeResponse> {
    const settings = await this.settings.get();
    const tz = settings.businessTimezone;
    const now = new Date();
    const sub = auth.subscription;
    const row = await this.prisma.user.findUniqueOrThrow({
      where: { id: auth.user.id },
      select: {
        name: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        loginId: true,
        enquiryStatus: true,
        subscription: { select: { kind: true, startsAt: true, expiresAt: true } },
        trialGrants: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    const kind = (row.subscription?.kind as SubscriptionKind | undefined) ?? null;
    const grant = trialToGreet(
      row.trialGrants[0] ?? null,
      row.subscription ? { ...row.subscription, kind: kind as SubscriptionKind } : null,
      now,
    );
    const subscriber = auth.user.role === 'SUBSCRIBER';
    return {
      id: auth.user.id,
      name: auth.user.name,
      loginId: auth.user.loginId,
      role: auth.user.role,
      next: auth.next,
      mfaEnabled: auth.user.mfaEnabledAt !== null,
      subscription: {
        state: subscriptionState(sub, now),
        kind,
        startsAt: sub?.startsAt.toISOString() ?? null,
        expiresAt: sub?.expiresAt.toISOString() ?? null,
        lastValidDate: sub ? lastValidLocalDate(sub.expiresAt, tz) : null,
        daysRemaining: sub ? daysRemaining(sub, now, tz) : 0,
        timezone: tz,
      },
      access: { allowed: auth.access.allowed, reason: auth.access.reason },
      support: {
        serviceName: settings.serviceName,
        whatsapp: settings.supportWhatsapp,
        email: settings.supportEmail,
        contact: settings.supportContact,
        renewalInstructions: settings.renewalInstructions,
      },
      enquiryStatus: row.enquiryStatus as EnquiryStatus,
      profile: subscriber ? { ...splitName(row), email: row.email ?? row.loginId, mobile: row.phone ?? '' } : null,
      trialGreeting:
        subscriber && grant
          ? {
              grantId: grant.id,
              durationDays: grant.durationDays,
              lastValidDate: lastValidLocalDate(grant.expiresAt, tz),
            }
          : null,
      onboardedAt: auth.user.onboardedAt?.toISOString() ?? null,
      isMasterAdmin: auth.user.isMasterAdmin,
      security: {
        // Administrators work on their own desk screens; the rule is for subscribers.
        screenshotsAllowed:
          auth.user.role === 'ADMIN'
            ? true
            : screenshotsAllowedFor(auth.user.screenshotsAllowed, settings.screenshotsAllowedDefault),
      },
    };
  }

  @Post('change-password')
  @AllowIncompleteSession()
  @HttpCode(200)
  @Summary('Change your password. Signs out your other devices.')
  async changePassword(
    @Auth() auth: AuthContext,
    @ZBody(changePasswordSchema) body: z.infer<typeof changePasswordSchema>,
  ) {
    await this.auth.changePassword(auth, body.currentPassword, body.newPassword);
    return { ok: true };
  }

  @Post('mfa/setup')
  @AllowIncompleteSession()
  @HttpCode(200)
  @Summary('Start two-step verification setup')
  mfaSetup(@Auth() auth: AuthContext) {
    return this.auth.beginMfaSetup(auth);
  }

  @Post('mfa/enable')
  @AllowIncompleteSession()
  @HttpCode(200)
  @Summary('Confirm setup with a code. Returns recovery codes once.')
  mfaEnable(@Auth() auth: AuthContext, @ZBody(mfaCodeSchema) body: z.infer<typeof mfaCodeSchema>) {
    return this.auth.enableMfa(auth, body.code);
  }

  @Post('mfa/verify')
  @AllowIncompleteSession()
  @HttpCode(200)
  @Summary('Complete sign-in with a code or a recovery code')
  async mfaVerify(@Auth() auth: AuthContext, @ZBody(mfaCodeSchema) body: z.infer<typeof mfaCodeSchema>) {
    await this.auth.verifyMfa(auth, body.code);
    return { ok: true };
  }
}
