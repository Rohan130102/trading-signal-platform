import { Injectable } from '@nestjs/common';
import type { AdminAccount, adminStatusSchema, createAdminSchema, masterAdminSchema } from '@signaldesk/domain';
import type { z } from 'zod';
import { AppError, notFound } from '../common/http.js';
import { newTemporaryPassword } from '../common/crypto.js';
import { isUniqueViolation, Prisma, PrismaService, type Tx, TX_OPTIONS } from '../db/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthService } from '../auth/auth.service.js';

const TEMP_PASSWORD_HOURS = 24;

interface MasterActor {
  id: string;
  requestId: string;
}

type AdminRow = Prisma.UserGetPayload<{ include: { createdBy: { select: { name: true } } } }>;

/**
 * Registration and management of administrators. Only the Master Admin reaches this (see MasterOnly).
 * New administrators get a temporary password shown once, must replace it, and must set up two-step
 * verification before they can do anything. There is always at least one active Master Admin.
 */
@Injectable()
export class AdminsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  private present(row: AdminRow, viewerId: string): AdminAccount {
    return {
      id: row.id,
      name: row.name,
      loginId: row.loginId,
      email: row.email,
      status: row.status,
      isMasterAdmin: row.isMasterAdmin,
      mfaEnabled: row.mfaEnabledAt !== null,
      mustChangePassword: row.mustChangePassword,
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy?.name ?? null,
      isYou: row.id === viewerId,
    };
  }

  async list(viewerId: string): Promise<AdminAccount[]> {
    const rows = await this.prisma.user.findMany({
      where: { role: 'ADMIN' },
      include: { createdBy: { select: { name: true } } },
      orderBy: [{ isMasterAdmin: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => this.present(r, viewerId));
  }

  private async load(id: string, tx: Tx = this.prisma): Promise<AdminRow> {
    const row = await tx.user.findFirst({
      where: { id, role: 'ADMIN' },
      include: { createdBy: { select: { name: true } } },
    });
    if (!row) throw notFound('Administrator not found');
    return row;
  }

  /** The temporary password is returned this once and exists nowhere else in readable form. */
  async create(input: z.infer<typeof createAdminSchema>, actor: MasterActor) {
    const replay = await this.replayed(input.idempotencyKey);
    if (replay) return { admin: this.present(await this.load(replay), actor.id), temporaryPassword: null };

    const temporaryPassword = newTemporaryPassword();
    const passwordHash = await this.auth.hashPassword(temporaryPassword);
    const loginId = input.loginId.toLowerCase();
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            role: 'ADMIN',
            name: input.name,
            email: input.email?.toLowerCase() ?? null,
            loginId,
            passwordHash,
            mustChangePassword: true,
            tempPasswordExpiresAt: new Date(Date.now() + TEMP_PASSWORD_HOURS * 3_600_000),
            createdById: actor.id,
          },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            action: 'ADMIN_CREATED',
            targetType: 'user',
            targetId: user.id,
            metadata: { loginId, idempotencyKey: input.idempotencyKey },
            requestId: actor.requestId,
          },
          tx,
        );
        return user.id;
      }, TX_OPTIONS);
      return { admin: this.present(await this.load(id), actor.id), temporaryPassword };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const again = await this.replayed(input.idempotencyKey);
      if (again) return { admin: this.present(await this.load(again), actor.id), temporaryPassword: null };
      throw new AppError(409, 'LOGIN_ID_TAKEN', 'That login ID is already in use.');
    }
  }

  private async replayed(idempotencyKey: string): Promise<string | null> {
    const row = await this.prisma.auditLog.findFirst({
      where: { action: 'ADMIN_CREATED', metadata: { path: ['idempotencyKey'], equals: idempotencyKey } },
      select: { targetId: true },
    });
    return row?.targetId ?? null;
  }

  /** Locks every Master Admin row, so two changes at once cannot both leave the platform without one. */
  private async activeMasters(tx: Tx): Promise<string[]> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM users WHERE role = 'ADMIN' AND is_master_admin AND status = 'ACTIVE' FOR UPDATE`;
    return rows.map((r) => r.id);
  }

  async setStatus(id: string, input: z.infer<typeof adminStatusSchema>, actor: MasterActor) {
    if (id === actor.id) {
      throw new AppError(422, 'CANNOT_CHANGE_SELF', 'You cannot suspend or disable your own account.');
    }
    return this.prisma.$transaction(async (tx) => {
      const masters = await this.activeMasters(tx);
      const row = await this.load(id, tx);
      if (row.status === input.status) return this.present(row, actor.id);
      if (input.status !== 'ACTIVE' && row.isMasterAdmin && masters.filter((m) => m !== id).length === 0) {
        throw new AppError(409, 'LAST_MASTER_ADMIN', 'Make another administrator Master Admin first.');
      }
      await tx.user.update({ where: { id }, data: { status: input.status } });
      // A suspended or disabled administrator is signed out everywhere at once.
      const revoked = input.status === 'ACTIVE' ? 0 : await this.auth.revokeAllSessions(id, tx);
      await this.audit.record(
        {
          actorId: actor.id,
          action: input.status === 'ACTIVE' ? 'ADMIN_REACTIVATED' : `ADMIN_${input.status}`,
          targetType: 'user',
          targetId: id,
          metadata: { from: row.status, to: input.status, note: input.note ?? null, sessionsEnded: revoked },
          requestId: actor.requestId,
        },
        tx,
      );
      return this.present(await this.load(id, tx), actor.id);
    }, TX_OPTIONS);
  }

  async setMaster(id: string, input: z.infer<typeof masterAdminSchema>, actor: MasterActor) {
    return this.prisma.$transaction(async (tx) => {
      const masters = await this.activeMasters(tx);
      const row = await this.load(id, tx);
      if (row.isMasterAdmin === input.isMasterAdmin) return this.present(row, actor.id);
      if (input.isMasterAdmin && row.status !== 'ACTIVE') {
        throw new AppError(422, 'ADMIN_NOT_ACTIVE', 'Reactivate this administrator first.');
      }
      if (!input.isMasterAdmin && masters.filter((m) => m !== id).length === 0) {
        throw new AppError(409, 'LAST_MASTER_ADMIN', 'Make another administrator Master Admin first.');
      }
      await tx.user.update({ where: { id }, data: { isMasterAdmin: input.isMasterAdmin } });
      await this.audit.record(
        {
          actorId: actor.id,
          action: input.isMasterAdmin ? 'MASTER_ADMIN_GRANTED' : 'MASTER_ADMIN_REVOKED',
          targetType: 'user',
          targetId: id,
          metadata: { note: input.note ?? null },
          requestId: actor.requestId,
        },
        tx,
      );
      return this.present(await this.load(id, tx), actor.id);
    }, TX_OPTIONS);
  }

  /**
   * A new temporary password. Two-step verification is cleared, so the administrator enrols again, and every
   * session ends. For an administrator who lost access; the Master Admin cannot reset themself this way.
   */
  async resetAccess(id: string, actor: MasterActor) {
    if (id === actor.id) {
      throw new AppError(422, 'CANNOT_CHANGE_SELF', 'Change your own password from your account instead.');
    }
    const row = await this.load(id);
    const temporaryPassword = newTemporaryPassword();
    const passwordHash = await this.auth.hashPassword(temporaryPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          passwordHash,
          mustChangePassword: true,
          tempPasswordExpiresAt: new Date(Date.now() + TEMP_PASSWORD_HOURS * 3_600_000),
          mfaSecretEnc: null,
          mfaEnabledAt: null,
          mfaLastStep: null,
        },
      });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: id } });
      const revoked = await this.auth.revokeAllSessions(id, tx);
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'ADMIN_ACCESS_RESET',
          targetType: 'user',
          targetId: id,
          metadata: { loginId: row.loginId, sessionsEnded: revoked },
          requestId: actor.requestId,
        },
        tx,
      );
    }, TX_OPTIONS);
    return { admin: this.present(await this.load(id), actor.id), temporaryPassword };
  }
}
