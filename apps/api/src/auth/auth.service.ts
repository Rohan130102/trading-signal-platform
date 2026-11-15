import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { APP_UPDATE_REQUIRED_MESSAGE, evaluateSignalAccess, type AccessDecision } from '@signaldesk/domain';
import argon2 from 'argon2';
import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';
import { AppError, type AuthContext, type AuthUser } from '../common/http.js';
import { decryptSecret, encryptSecret, hashToken, newRecoveryCode, newSessionToken } from '../common/crypto.js';
import { env } from '../config/env.js';
import { CH_ACCESS } from '../db/listener.service.js';
import { PrismaService, type Tx } from '../db/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DevicesService } from '../devices/devices.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { RateLimitService } from './rate-limit.service.js';

const WINDOW_SECONDS = 15 * 60;
const MAX_FAILURES_PER_ID = 8;
const MAX_FAILURES_PER_IP = 40;
const MAX_MFA_FAILURES = 6;
const COMMON_PASSWORDS = new Set([
  'password123',
  'password1234',
  '1234567890',
  '12345678910',
  'qwertyuiop',
  'iloveyou123',
  'admin12345',
  'welcome123',
  'letmein1234',
]);

const INVALID = new AppError(401, 'INVALID_CREDENTIALS', 'That email, username or password is not right.');
const THROTTLED = new AppError(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts. Wait 15 minutes and try again.');

function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

type SessionRow = NonNullable<Awaited<ReturnType<AuthService['loadByToken']>>>;

@Injectable()
export class AuthService {
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly limits: RateLimitService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly devices: DevicesService,
  ) {}

  hashPassword(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  private loadByToken(tokenHash: string) {
    return this.prisma.session.findUnique({
      where: { tokenHash },
      include: { user: { include: { subscription: true } } },
    });
  }

  private buildContext(row: SessionRow, now: Date): AuthContext | null {
    if (row.revokedAt || row.expiresAt.getTime() <= now.getTime()) return null;
    const { user } = row;
    if (user.status !== 'ACTIVE') return null;
    if (user.role === 'ADMIN') {
      const idleLimit = env.ADMIN_IDLE_MINUTES * 60_000;
      if (now.getTime() - row.lastSeenAt.getTime() > idleLimit) return null;
    }
    const authUser: AuthUser = {
      id: user.id,
      role: user.role,
      status: user.status,
      name: user.name,
      loginId: user.loginId,
      mustChangePassword: user.mustChangePassword,
      mfaEnabledAt: user.mfaEnabledAt,
      lastReadSeq: user.lastReadSeq,
      onboardedAt: user.onboardedAt,
      isMasterAdmin: user.role === 'ADMIN' && user.isMasterAdmin,
      screenshotsAllowed: user.screenshotsAllowed,
    };
    const subscription = user.subscription
      ? { startsAt: user.subscription.startsAt, expiresAt: user.subscription.expiresAt }
      : null;
    const mfaVerified = user.role !== 'ADMIN' || row.mfaVerifiedAt !== null;
    let next: AuthContext['next'] = null;
    if (user.mustChangePassword) next = 'CHANGE_PASSWORD';
    else if (user.role === 'ADMIN' && !user.mfaEnabledAt) next = 'MFA_SETUP';
    else if (!mfaVerified) next = 'MFA_VERIFY';
    return {
      sessionId: row.id,
      installationId: row.installationId,
      user: authUser,
      subscription,
      access: evaluateSignalAccess(user, subscription, now),
      mfaVerified,
      next,
    };
  }

  /** Runs on every authenticated request: revocation and expiry apply to the very next call. */
  async authenticate(token: string, now = new Date()): Promise<AuthContext | null> {
    const row = await this.loadByToken(hashToken(token));
    if (!row) return null;
    const context = this.buildContext(row, now);
    if (!context) return null;
    if (now.getTime() - row.lastSeenAt.getTime() > 60_000) {
      // A subscriber who keeps using the app stays signed in, and so keeps getting alerts on that device.
      const slide =
        row.user.role === 'SUBSCRIBER'
          ? { expiresAt: new Date(now.getTime() + env.SESSION_TTL_DAYS * 86_400_000) }
          : {};
      await this.prisma.session.update({ where: { id: row.id }, data: { lastSeenAt: now, ...slide } });
    }
    return context;
  }

  /** Bulk re-check used by the realtime gateway for its open connections. */
  async decisionsForSessions(ids: string[], now = new Date()): Promise<Map<string, AccessDecision | null>> {
    const rows = await this.prisma.session.findMany({
      where: { id: { in: ids } },
      include: { user: { include: { subscription: true } } },
    });
    const out = new Map<string, AccessDecision | null>(ids.map((id) => [id, null]));
    for (const row of rows) {
      const context = this.buildContext(row, now);
      out.set(row.id, context && !context.next ? context.access : null);
    }
    return out;
  }

  /**
   * `installation` is present only for the native app. A subscriber must send one: it binds this
   * installation to their account, and a second account is refused on it (see DevicesService).
   */
  async login(
    identifier: string,
    password: string,
    ip: string,
    device: string | undefined,
    installation?: { installationId?: string; platform?: string },
  ) {
    const loginId = identifier.trim().toLowerCase();
    const idKey = `login:id:${fingerprint(loginId)}`;
    const ipKey = `login:ip:${fingerprint(ip)}`;
    const [idFailures, ipFailures] = await Promise.all([
      this.limits.count(idKey, WINDOW_SECONDS),
      this.limits.count(ipKey, WINDOW_SECONDS),
    ]);
    if (idFailures >= MAX_FAILURES_PER_ID || ipFailures >= MAX_FAILURES_PER_IP) throw THROTTLED;

    const user = await this.findByIdentifier(loginId);
    // An unknown login does the same work as a known one, so timing does not reveal which IDs exist.
    this.dummyHash ??= this.hashPassword('not-a-real-password');
    const matches = await argon2.verify(user?.passwordHash ?? (await this.dummyHash), password);
    if (!user || !matches || user.status !== 'ACTIVE') {
      await Promise.all([this.limits.hit(idKey, WINDOW_SECONDS), this.limits.hit(ipKey, WINDOW_SECONDS)]);
      await this.audit.record({
        actorId: user?.id ?? null,
        action: 'LOGIN_FAILED',
        metadata: { reason: !user ? 'unknown' : !matches ? 'password' : 'status' },
      });
      throw INVALID;
    }
    if (user.mustChangePassword && user.tempPasswordExpiresAt && user.tempPasswordExpiresAt.getTime() < Date.now()) {
      throw new AppError(401, 'TEMP_PASSWORD_EXPIRED', 'This temporary password has expired. Ask for a new one.');
    }

    await this.limits.clear(idKey);
    if (installation) {
      if (!installation.installationId) {
        if (user.role === 'SUBSCRIBER') throw new AppError(426, 'APP_UPDATE_REQUIRED', APP_UPDATE_REQUIRED_MESSAGE);
      } else {
        await this.devices.claim(user, {
          installationId: installation.installationId,
          platform: installation.platform,
          deviceLabel: device,
        });
      }
    }
    const token = newSessionToken();
    const ttl = user.role === 'ADMIN' ? env.ADMIN_SESSION_TTL_HOURS * 3_600_000 : env.SESSION_TTL_DAYS * 86_400_000;
    await this.prisma.$transaction(async (tx) => {
      await tx.session.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + ttl),
          deviceLabel: device?.slice(0, 120),
          installationId: installation?.installationId ?? null,
        },
      });
      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      await this.audit.record(
        { actorId: user.id, action: 'LOGIN_SUCCEEDED', targetType: 'user', targetId: user.id },
        tx,
      );
    });
    return { token, ttlMs: ttl };
  }

  /**
   * A login ID first, as before. Failing that, an email address signs in the one account that has it: every
   * self-registered account, and older accounts whose contact email is unique.
   */
  private async findByIdentifier(identifier: string) {
    const byLogin = await this.prisma.user.findUnique({ where: { loginId: identifier } });
    if (byLogin || !identifier.includes('@')) return byLogin;
    const byEmail = await this.prisma.user.findMany({
      where: { email: { equals: identifier, mode: 'insensitive' } },
      take: 2,
    });
    return byEmail.length === 1 ? (byEmail[0] ?? null) : null;
  }

  async logout(sessionId: string, actorId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
      await this.audit.record({ actorId, action: 'LOGOUT', targetType: 'session', targetId: sessionId }, tx);
      await this.notifyAccessChange(tx, actorId);
    });
  }

  async revokeAllSessions(userId: string, tx: Tx = this.prisma, exceptSessionId?: string): Promise<number> {
    const result = await tx.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date() },
    });
    await this.notifyAccessChange(tx, userId);
    return result.count;
  }

  /** Delivered at commit. Open sockets for this user re-check their access straight away. */
  async notifyAccessChange(tx: Tx, userId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_notify(${CH_ACCESS}, ${userId})`;
  }

  validateNewPassword(password: string, loginId: string): void {
    const lowered = password.toLowerCase();
    if (COMMON_PASSWORDS.has(lowered) || lowered.includes(loginId.toLowerCase())) {
      throw new AppError(
        422,
        'WEAK_PASSWORD',
        'That password is too easy to guess. Avoid common passwords and anything containing your login ID.',
      );
    }
  }

  async changePassword(auth: AuthContext, current: string, next: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });
    const key = `pwchange:${user.id}`;
    if ((await this.limits.count(key, WINDOW_SECONDS)) >= MAX_FAILURES_PER_ID) throw THROTTLED;
    if (!(await argon2.verify(user.passwordHash, current))) {
      await this.limits.hit(key, WINDOW_SECONDS);
      throw new AppError(422, 'INVALID_CURRENT_PASSWORD', 'Your current password is not right.');
    }
    if (current === next) {
      throw new AppError(422, 'WEAK_PASSWORD', 'Choose a password different from the current one.');
    }
    this.validateNewPassword(next, user.loginId);
    const passwordHash = await this.hashPassword(next);
    await this.limits.clear(key);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false, tempPasswordExpiresAt: null },
      });
      // Replacing a recovery password finishes that recovery request.
      if (user.mustChangePassword) {
        await tx.passwordResetRequest.updateMany({
          where: { userId: user.id, status: 'PASSWORD_ISSUED' },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
      }
      await this.revokeAllSessions(user.id, tx, auth.sessionId);
      await this.audit.record(
        { actorId: user.id, action: 'PASSWORD_CHANGED', targetType: 'user', targetId: user.id },
        tx,
      );
    });
  }

  async beginMfaSetup(auth: AuthContext) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (user.mfaEnabledAt) throw new AppError(409, 'MFA_ALREADY_ENABLED', 'Two-step verification is already on.');
    const secret = generateSecret();
    await this.prisma.user.update({ where: { id: user.id }, data: { mfaSecretEnc: encryptSecret(secret) } });
    const settings = await this.settings.get();
    const uri = generateURI({ issuer: settings.serviceName, label: user.loginId, secret });
    return { secret, uri, qrSvg: await QRCode.toString(uri, { type: 'svg', margin: 1 }) };
  }

  private async checkTotp(userId: string, sealed: string, code: string, lastStep: bigint | null): Promise<boolean> {
    if (!/^\d{6}$/.test(code)) return false;
    const result = await verify({ secret: decryptSecret(sealed), token: code, epochTolerance: 30 });
    if (!result.valid) return false;
    if (!('timeStep' in result)) return false;
    const step = BigInt(result.timeStep);
    // A code works once, even inside its validity window, so an observed code cannot be replayed.
    if (lastStep !== null && step <= lastStep) return false;
    await this.prisma.user.update({ where: { id: userId }, data: { mfaLastStep: step } });
    return true;
  }

  async enableMfa(auth: AuthContext, code: string): Promise<{ recoveryCodes: string[] }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (user.mfaEnabledAt) throw new AppError(409, 'MFA_ALREADY_ENABLED', 'Two-step verification is already on.');
    if (!user.mfaSecretEnc) throw new AppError(409, 'MFA_NOT_STARTED', 'Start the setup again.');
    await this.assertMfaAttemptsLeft(user.id);
    if (!(await this.checkTotp(user.id, user.mfaSecretEnc, code, user.mfaLastStep))) {
      await this.limits.hit(`mfa:${user.id}`, WINDOW_SECONDS);
      throw new AppError(422, 'INVALID_CODE', 'That code is not right. Check the time on your phone and try again.');
    }
    const codes = Array.from({ length: 8 }, newRecoveryCode);
    const hashes = await Promise.all(codes.map((c) => this.hashPassword(c)));
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { mfaEnabledAt: new Date() } });
      await tx.mfaRecoveryCode.createMany({ data: hashes.map((codeHash) => ({ userId: user.id, codeHash })) });
      await tx.session.update({ where: { id: auth.sessionId }, data: { mfaVerifiedAt: new Date() } });
      await this.revokeAllSessions(user.id, tx, auth.sessionId);
      await this.audit.record({ actorId: user.id, action: 'MFA_ENABLED', targetType: 'user', targetId: user.id }, tx);
    });
    return { recoveryCodes: codes };
  }

  private async assertMfaAttemptsLeft(userId: string): Promise<void> {
    if ((await this.limits.count(`mfa:${userId}`, WINDOW_SECONDS)) >= MAX_MFA_FAILURES) throw THROTTLED;
  }

  async verifyMfa(auth: AuthContext, code: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: auth.user.id },
      include: { recoveryCodes: { where: { usedAt: null } } },
    });
    if (!user.mfaEnabledAt || !user.mfaSecretEnc)
      throw new AppError(409, 'MFA_NOT_ENABLED', 'Set up two-step verification first.');
    await this.assertMfaAttemptsLeft(user.id);

    let ok = await this.checkTotp(user.id, user.mfaSecretEnc, code.trim(), user.mfaLastStep);
    let usedRecovery = false;
    if (!ok && code.includes('-')) {
      for (const candidate of user.recoveryCodes) {
        if (await argon2.verify(candidate.codeHash, code.trim().toUpperCase())) {
          const claim = await this.prisma.mfaRecoveryCode.updateMany({
            where: { id: candidate.id, usedAt: null },
            data: { usedAt: new Date() },
          });
          ok = claim.count === 1;
          usedRecovery = ok;
          break;
        }
      }
    }
    if (!ok) {
      await this.limits.hit(`mfa:${user.id}`, WINDOW_SECONDS);
      await this.audit.record({ actorId: user.id, action: 'MFA_FAILED', targetType: 'user', targetId: user.id });
      throw new AppError(422, 'INVALID_CODE', 'That code is not right. Check the time on your phone and try again.');
    }
    await this.limits.clear(`mfa:${user.id}`);
    await this.prisma.session.update({ where: { id: auth.sessionId }, data: { mfaVerifiedAt: new Date() } });
    await this.audit.record({
      actorId: user.id,
      action: usedRecovery ? 'MFA_RECOVERY_CODE_USED' : 'MFA_VERIFIED',
      targetType: 'user',
      targetId: user.id,
    });
  }
}
