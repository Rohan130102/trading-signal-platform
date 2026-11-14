import { Injectable } from '@nestjs/common';
import type { PasswordResetRow, PasswordResetStatus } from '@signaldesk/domain';
import { AuditService } from '../audit/audit.service.js';
import { AuthService } from '../auth/auth.service.js';
import { AppError, notFound } from '../common/http.js';
import { newTemporaryPassword } from '../common/crypto.js';
import { PrismaService, TX_OPTIONS, type Tx } from '../db/prisma.service.js';
import type { Actor } from '../trades/trades.service.js';

/** A recovery password is short-lived: it only has to last until the person signs in and replaces it. */
export const RESET_PASSWORD_HOURS = 24;

const OPEN: PasswordResetStatus[] = ['OPEN', 'PASSWORD_ISSUED'];

/**
 * Administrator-managed recovery. The person proved their address; an administrator issues a temporary password,
 * shown once and stored only as a hash, which must be replaced at the next sign-in.
 */
@Injectable()
export class PasswordResetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  async list(status: 'OPEN' | 'ALL'): Promise<{ requests: PasswordResetRow[]; open: number }> {
    const [rows, open] = await Promise.all([
      this.prisma.passwordResetRequest.findMany({
        where: status === 'OPEN' ? { status: { in: OPEN } } : {},
        include: { user: { select: { name: true, loginId: true } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      this.prisma.passwordResetRequest.count({ where: { status: 'OPEN' } }),
    ]);
    return {
      open,
      requests: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        name: r.user.name,
        email: r.email,
        loginId: r.user.loginId,
        requestedAt: r.createdAt.toISOString(),
        emailVerified: true,
        status: r.status as PasswordResetStatus,
        issuedAt: r.issuedAt?.toISOString() ?? null,
        completedAt: r.completedAt?.toISOString() ?? null,
      })),
    };
  }

  /** Returns the temporary password this once. It is never stored readable, logged or shown again. */
  async issue(id: string, actor: Actor) {
    const request = await this.prisma.passwordResetRequest.findUnique({ where: { id }, include: { user: true } });
    if (!request) throw notFound('Request not found');
    if (!OPEN.includes(request.status as PasswordResetStatus)) {
      throw new AppError(409, 'REQUEST_CLOSED', 'This request is already closed.');
    }
    if (request.user.role !== 'SUBSCRIBER') throw new AppError(409, 'NOT_A_SUBSCRIBER', 'Only subscriber passwords are reset here.');
    const temporaryPassword = newTemporaryPassword();
    const passwordHash = await this.auth.hashPassword(temporaryPassword);
    const expiresAt = new Date(Date.now() + RESET_PASSWORD_HOURS * 3_600_000);
    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.passwordResetRequest.updateMany({
        where: { id, status: { in: OPEN } },
        data: { status: 'PASSWORD_ISSUED', issuedAt: new Date(), issuedById: actor.id },
      });
      if (claim.count !== 1) throw new AppError(409, 'REQUEST_CLOSED', 'This request is already closed.');
      await tx.user.update({
        where: { id: request.userId },
        data: { passwordHash, mustChangePassword: true, tempPasswordExpiresAt: expiresAt },
      });
      // The old password stops working and every device is signed out.
      await this.auth.revokeAllSessions(request.userId, tx);
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'PASSWORD_RESET_ISSUED',
          targetType: 'user',
          targetId: request.userId,
          metadata: { requestId: id, expiresAt: expiresAt.toISOString() },
          requestId: actor.requestId,
        },
        tx,
      );
    }, TX_OPTIONS);
    return { loginId: request.user.loginId, temporaryPassword, expiresAt: expiresAt.toISOString() };
  }

  async close(id: string, status: 'COMPLETED' | 'DISMISSED', actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.passwordResetRequest.updateMany({
        where: { id, status: { in: OPEN } },
        data: { status, completedAt: new Date(), completedById: actor.id },
      });
      if (claim.count !== 1) {
        const exists = await tx.passwordResetRequest.findUnique({ where: { id }, select: { id: true } });
        throw exists ? new AppError(409, 'REQUEST_CLOSED', 'This request is already closed.') : notFound('Request not found');
      }
      await this.audit.record(
        {
          actorId: actor.id,
          action: status === 'COMPLETED' ? 'PASSWORD_RESET_COMPLETED' : 'PASSWORD_RESET_DISMISSED',
          targetType: 'password_reset_request',
          targetId: id,
          requestId: actor.requestId,
        },
        tx,
      );
    });
    return { ok: true };
  }

  /** Called when someone replaces a temporary password: their recovery is then finished. */
  static async completeForUser(tx: Tx, userId: string): Promise<void> {
    await tx.passwordResetRequest.updateMany({
      where: { userId, status: 'PASSWORD_ISSUED' },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
  }
}
