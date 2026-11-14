import { Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import {
  type ChallengeResponse,
  completeRegistrationSchema,
  passwordResetRequestSchema,
  registrationSchema,
  resendCodeSchema,
  type TokenLoginResponse,
  verifyCodeSchema,
} from '@signaldesk/domain';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { AuthService } from '../auth/auth.service.js';
import { SESSION_COOKIE } from '../auth/session.guard.js';
import { ClientIp, Public, Summary, ZBody } from '../common/http.js';
import { isProduction } from '../config/env.js';
import { RegistrationService } from './registration.service.js';

@Controller('auth')
export class RegistrationController {
  constructor(
    private readonly registration: RegistrationService,
    private readonly auth: AuthService,
  ) {}

  @Post('register')
  @Public()
  @HttpCode(200)
  @Summary('Start sign-up. Sends a code to the address. The answer is the same whether or not it has an account.')
  register(
    @ZBody(registrationSchema) body: z.output<typeof registrationSchema>,
    @ClientIp() ip: string,
  ): Promise<ChallengeResponse> {
    return this.registration.start(body, ip);
  }

  @Post('register/resend')
  @Public()
  @HttpCode(200)
  @Summary('Send a new sign-up code. At most once a minute; the new code replaces the last.')
  resend(@ZBody(resendCodeSchema) body: z.output<typeof resendCodeSchema>, @ClientIp() ip: string) {
    return this.registration.resend(body.challengeId, ip);
  }

  @Post('register/verify')
  @Public()
  @HttpCode(200)
  @Summary('Check the sign-up code. Returns a single-use token for creating the password.')
  verify(@ZBody(verifyCodeSchema) body: z.output<typeof verifyCodeSchema>, @ClientIp() ip: string) {
    return this.registration.verify(body.challengeId, body.code, ip);
  }

  @Post('register/complete')
  @Public()
  @HttpCode(200)
  @Summary('Create the password and the account, and sign in on this browser')
  async complete(
    @ZBody(completeRegistrationSchema) body: z.output<typeof completeRegistrationSchema>,
    @ClientIp() ip: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { email } = await this.registration.complete(body, ip);
    const { token, ttlMs } = await this.auth.login(email, body.password, ip, req.headers['user-agent']?.slice(0, 120));
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/', maxAge: ttlMs });
    return { ok: true };
  }

  @Post('register/complete-token')
  @Public()
  @HttpCode(200)
  @Summary('Create the password and the account from the native app. Returns a bearer token, once.')
  async completeNative(
    @ZBody(completeRegistrationSchema) body: z.output<typeof completeRegistrationSchema>,
    @ClientIp() ip: string,
  ): Promise<TokenLoginResponse> {
    const { email } = await this.registration.complete(body, ip);
    const { token, ttlMs } = await this.auth.login(email, body.password, ip, body.deviceLabel, {
      installationId: body.installationId,
      platform: body.platform,
    });
    return { token, expiresAt: new Date(Date.now() + ttlMs).toISOString() };
  }

  @Post('password-reset')
  @Public()
  @HttpCode(200)
  @Summary('Start password recovery. A code goes only to an address with an account; the answer is the same.')
  startReset(
    @ZBody(passwordResetRequestSchema) body: z.output<typeof passwordResetRequestSchema>,
    @ClientIp() ip: string,
  ): Promise<ChallengeResponse> {
    return this.registration.startPasswordReset(body.email, ip);
  }

  @Post('password-reset/resend')
  @Public()
  @HttpCode(200)
  @Summary('Send a new recovery code')
  resendReset(@ZBody(resendCodeSchema) body: z.output<typeof resendCodeSchema>, @ClientIp() ip: string) {
    return this.registration.resendPasswordReset(body.challengeId, ip);
  }

  @Post('password-reset/verify')
  @Public()
  @HttpCode(200)
  @Summary('Check the recovery code and send the request to the administrators')
  verifyReset(@ZBody(verifyCodeSchema) body: z.output<typeof verifyCodeSchema>, @ClientIp() ip: string) {
    return this.registration.verifyPasswordReset(body.challengeId, body.code, ip);
  }
}
