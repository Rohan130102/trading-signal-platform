import { Injectable } from '@nestjs/common';
import {
  type BindingDecision,
  decideDeviceBinding,
  DEVICE_BOUND_MESSAGE,
  type DeviceBindingView,
  type Role,
} from '@signaldesk/domain';
import { AppError, notFound } from '../common/http.js';
import { CH_ACCESS } from '../db/listener.service.js';
import { PrismaService } from '../db/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';

export interface InstallationClaim {
  installationId: string;
  platform?: string;
  deviceLabel?: string;
}

/**
 * One subscriber per app installation, decided here and nowhere else. Signing out does not release a
 * binding: only an administrator can, and doing so signs that installation out of the old account.
 */
@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Called after the password has been checked, so nothing about bindings leaks to someone without it.
   * Concurrent sign-ins on one installation race on a unique index, and exactly one account wins.
   */
  async claim(user: { id: string; role: Role }, claim: InstallationClaim): Promise<BindingDecision> {
    if (user.role === 'ADMIN') return decideDeviceBinding({ role: user.role, userId: user.id, boundUserId: null });
    await this.prisma.$executeRaw`
      INSERT INTO device_bindings (id, installation_id, user_id, platform, device_label)
      VALUES (gen_random_uuid(), ${claim.installationId}, ${user.id}::uuid, ${claim.platform ?? null},
              ${claim.deviceLabel?.slice(0, 120) ?? null})
      ON CONFLICT (installation_id) WHERE released_at IS NULL DO NOTHING`;
    const current = await this.prisma.deviceBinding.findFirst({
      where: { installationId: claim.installationId, releasedAt: null },
      select: { id: true, userId: true, boundAt: true },
    });
    const decision = decideDeviceBinding({ role: user.role, userId: user.id, boundUserId: current?.userId ?? null });
    if (decision === 'BLOCK') {
      await this.audit.record({
        actorId: user.id,
        action: 'DEVICE_BINDING_BLOCKED',
        targetType: 'device_binding',
        targetId: current?.id,
        metadata: { platform: claim.platform ?? null },
      });
      throw new AppError(403, 'DEVICE_BOUND', DEVICE_BOUND_MESSAGE);
    }
    if (current) {
      const fresh = Date.now() - current.boundAt.getTime() < 5000;
      await this.prisma.deviceBinding.update({
        where: { id: current.id },
        data: {
          lastSeenAt: new Date(),
          ...(claim.deviceLabel ? { deviceLabel: claim.deviceLabel.slice(0, 120) } : {}),
        },
      });
      if (fresh) {
        await this.audit.record({
          actorId: user.id,
          action: 'DEVICE_BOUND',
          targetType: 'device_binding',
          targetId: current.id,
          metadata: { platform: claim.platform ?? null },
        });
      }
    }
    return decision;
  }

  async forUser(userId: string): Promise<DeviceBindingView[]> {
    const rows = await this.prisma.deviceBinding.findMany({
      where: { userId },
      orderBy: [{ releasedAt: { sort: 'desc', nulls: 'first' } }, { lastSeenAt: 'desc' }],
      include: { releasedBy: { select: { name: true } } },
      take: 50,
    });
    const now = new Date();
    const live = await this.prisma.session.groupBy({
      by: ['installationId'],
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: now },
        installationId: { in: rows.map((r) => r.installationId) },
      },
      _count: { _all: true },
    });
    return rows.map((r) => ({
      id: r.id,
      platform: r.platform,
      deviceLabel: r.deviceLabel,
      boundAt: r.boundAt.toISOString(),
      lastSeenAt: r.lastSeenAt.toISOString(),
      releasedAt: r.releasedAt?.toISOString() ?? null,
      releasedByName: r.releasedBy?.name ?? null,
      releaseReason: r.releaseReason,
      activeSessions:
        r.releasedAt === null ? (live.find((l) => l.installationId === r.installationId)?._count._all ?? 0) : 0,
    }));
  }

  /** The installation this session signed in from, if it is bound to this person. */
  async currentFor(userId: string, installationId: string | null): Promise<DeviceBindingView | null> {
    if (!installationId) return null;
    const views = await this.forUser(userId);
    const row = await this.prisma.deviceBinding.findFirst({
      where: { userId, installationId, releasedAt: null },
      select: { id: true },
    });
    return views.find((v) => v.id === row?.id) ?? null;
  }

  /**
   * Frees an installation for another account: a replacement phone, a phone handed on, or a mistake. The
   * old account is signed out of that installation in the same transaction.
   */
  async release(bindingId: string, actorId: string, reason: string, requestId: string) {
    return this.prisma.$transaction(async (tx) => {
      const binding = await tx.deviceBinding.findUnique({ where: { id: bindingId } });
      if (!binding) throw notFound('Device not found');
      if (binding.releasedAt) throw new AppError(409, 'ALREADY_RELEASED', 'This device was already released.');
      await tx.deviceBinding.update({
        where: { id: bindingId },
        data: { releasedAt: new Date(), releasedById: actorId, releaseReason: reason },
      });
      const revoked = await tx.session.updateMany({
        where: { userId: binding.userId, installationId: binding.installationId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.$executeRaw`SELECT pg_notify(${CH_ACCESS}, ${binding.userId})`;
      await this.audit.record(
        {
          actorId,
          action: 'DEVICE_BINDING_RELEASED',
          targetType: 'device_binding',
          targetId: bindingId,
          metadata: { userId: binding.userId, reason, sessionsRevoked: revoked.count },
          requestId,
        },
        tx,
      );
      return { released: true, sessionsRevoked: revoked.count };
    });
  }
}
