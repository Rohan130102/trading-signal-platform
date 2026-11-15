import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ALLOW_INCOMPLETE,
  AppError,
  type AuthedRequest,
  bearerToken,
  forbidden,
  IS_PUBLIC,
  MASTER_ONLY,
  parseCookies,
  REQUIRES_SIGNAL_ACCESS,
  ROLES,
} from '../common/http.js';
import { AuthService } from './auth.service.js';
import { isProduction } from '../config/env.js';

export const SESSION_COOKIE = isProduction ? '__Host-sd_session' : 'sd_session';

/**
 * Global guard, default deny. Authorisation decisions read the database on every request rather than
 * trusting anything cached in a token, so expiry and revocation are immediate.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    // A bearer token is authoritative when present: there is no falling back to a cookie.
    const token = bearerToken(request.headers.authorization) ?? parseCookies(request.headers.cookie)[SESSION_COOKIE];
    const session = token ? await this.auth.authenticate(token) : null;
    if (session) request.auth = session;

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (!session) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in.');

    const allowIncomplete = this.reflector.getAllAndOverride<boolean>(ALLOW_INCOMPLETE, targets);
    if (session.next && !allowIncomplete) {
      throw new AppError(403, 'SESSION_STEP_REQUIRED', 'Finish signing in first.', { next: session.next });
    }
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES, targets);
    if (roles && !roles.includes(session.user.role)) throw forbidden();
    if (
      this.reflector.getAllAndOverride<boolean>(MASTER_ONLY, targets) &&
      !(session.user.role === 'ADMIN' && session.user.isMasterAdmin)
    ) {
      // The same answer as any other refusal: it says nothing about who could do this.
      throw forbidden();
    }

    if (this.reflector.getAllAndOverride<boolean>(REQUIRES_SIGNAL_ACCESS, targets) && !session.access.allowed) {
      throw new AppError(
        403,
        session.access.reason ?? 'FORBIDDEN',
        'Your subscription does not include access right now.',
      );
    }
    return true;
  }
}
