import { Injectable } from '@nestjs/common';
import {
  adjustSubscriptionSchema,
  computeInitialWindow,
  computeRenewal,
  createSubscriberSchema,
  daysRemaining,
  endOfLocalDateExclusive,
  lastValidLocalDate,
  listSubscribersQuery,
  localDateToInstant,
  renewSubscriptionSchema,
  screenshotsAllowedFor,
  subscriptionState,
  updateSubscriberSchema,
} from '@signaldesk/domain';
import type { z } from 'zod';
import { AppError, notFound } from '../common/http.js';
import { newTemporaryPassword } from '../common/crypto.js';
import { notifyRefresh } from '../db/listener.service.js';
import { isUniqueViolation, Prisma, PrismaService, TX_OPTIONS } from '../db/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthService } from '../auth/auth.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { Actor } from '../trades/trades.service.js';

const TEMP_PASSWORD_HOURS = 72;
const EXPIRING_DAYS = 7;

type Row = Prisma.UserGetPayload<{ include: { subscription: true } }>;

function requireActor(actor: Actor): string {
  return actor.id as string;
}

@Injectable()
export class SubscribersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  private present(row: Row, tz: string, screenshotsDefault: boolean, now = new Date()) {
    const sub = row.subscription;
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      loginId: row.loginId,
      status: row.status,
      notes: row.notes,
      mustChangePassword: row.mustChangePassword,
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      subscription: {
        state: subscriptionState(sub, now),
        startsAt: sub?.startsAt.toISOString() ?? null,
        expiresAt: sub?.expiresAt.toISOString() ?? null,
        lastValidDate: sub ? lastValidLocalDate(sub.expiresAt, tz) : null,
        daysRemaining: sub ? daysRemaining(sub, now, tz) : 0,
        timezone: tz,
      },
      screenshotsAllowed: row.screenshotsAllowed,
      screenshotsEffective: screenshotsAllowedFor(row.screenshotsAllowed, screenshotsDefault),
    };
  }

  /** The Master Admin's choice for one subscriber. Null follows the platform default. */
  async setScreenshotPermission(id: string, allowed: boolean | null, actor: Actor) {
    const row = await this.prisma.user.findFirst({ where: { id, role: 'SUBSCRIBER' } });
    if (!row) throw notFound('Subscriber not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { screenshotsAllowed: allowed } });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'SUBSCRIBER_SCREENSHOT_PERMISSION_SET',
          targetType: 'user',
          targetId: id,
          metadata: { from: row.screenshotsAllowed, to: allowed },
          requestId: actor.requestId,
        },
        tx,
      );
      // Their open app picks the new rule up at once.
      await notifyRefresh(tx, 'SETTINGS_CHANGED');
    });
    return this.detail(id);
  }

  async list(query: z.infer<typeof listSubscribersQuery>) {
    const [tz, platform] = await Promise.all([this.settings.timezone(), this.settings.platform()]);
    const now = new Date();
    const soon = new Date(now.getTime() + EXPIRING_DAYS * 86_400_000);
    const q = query.q?.trim();
    const accessFilter: Record<string, Prisma.UserWhereInput> = {
      ACTIVE: { status: 'ACTIVE', subscription: { startsAt: { lte: now }, expiresAt: { gt: now } } },
      EXPIRING: { status: 'ACTIVE', subscription: { startsAt: { lte: now }, expiresAt: { gt: now, lte: soon } } },
      EXPIRED: { subscription: { expiresAt: { lte: now } } },
      SCHEDULED: { subscription: { startsAt: { gt: now } } },
      SUSPENDED: { status: { not: 'ACTIVE' } },
    };
    const where: Prisma.UserWhereInput = {
      role: 'SUBSCRIBER',
      ...(query.access ? accessFilter[query.access] : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { loginId: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
              { phone: { contains: q } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: { subscription: true },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      subscribers: rows.map((r) => this.present(r, tz, platform.screenshotsAllowedDefault, now)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async detail(id: string) {
    const [tz, platform] = await Promise.all([this.settings.timezone(), this.settings.platform()]);
    const row = await this.prisma.user.findFirst({
      where: { id, role: 'SUBSCRIBER' },
      include: {
        subscription: {
          include: { events: { orderBy: { createdAt: 'desc' }, include: { actor: { select: { name: true } } } } },
        },
        pushSubscriptions: {
          where: { invalidatedAt: null },
          select: { id: true, deviceLabel: true, createdAt: true, lastAcceptedAt: true },
        },
        sessions: {
          where: { revokedAt: null, expiresAt: { gt: new Date() } },
          select: { id: true, deviceLabel: true, lastSeenAt: true },
          orderBy: { lastSeenAt: 'desc' },
        },
      },
    });
    if (!row) throw notFound('Subscriber not found');
    return {
      ...this.present(row, tz, platform.screenshotsAllowedDefault),
      events:
        row.subscription?.events.map((e) => ({
          id: e.id,
          type: e.type,
          mode: e.mode,
          durationDays: e.durationDays,
          previousExpiresAt: e.previousExpiresAt?.toISOString() ?? null,
          newStartsAt: e.newStartsAt.toISOString(),
          newExpiresAt: e.newExpiresAt.toISOString(),
          lastValidDate: lastValidLocalDate(e.newExpiresAt, tz),
          note: e.note,
          actorName: e.actor.name,
          createdAt: e.createdAt.toISOString(),
        })) ?? [],
      devices: row.pushSubscriptions.map((p) => ({
        id: p.id,
        deviceLabel: p.deviceLabel,
        createdAt: p.createdAt.toISOString(),
        lastAcceptedAt: p.lastAcceptedAt?.toISOString() ?? null,
      })),
      sessions: row.sessions.map((s) => ({
        id: s.id,
        deviceLabel: s.deviceLabel,
        lastSeenAt: s.lastSeenAt.toISOString(),
      })),
    };
  }

  /** The temporary password is returned this once and exists nowhere else in readable form. */
  async create(input: z.infer<typeof createSubscriberSchema>, actor: Actor) {
    const replay = await this.prisma.subscriptionEvent.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { subscription: { select: { userId: true } } },
    });
    if (replay)
      return { subscriber: await this.detail(replay.subscription.userId), temporaryPassword: null, replayed: true };

    const tz = await this.settings.timezone();
    const now = new Date();
    const startsAt = input.activationDate ? this.activationInstant(input.activationDate, tz, now) : now;
    const window = computeInitialWindow(startsAt, input.durationDays, tz);
    const temporaryPassword = newTemporaryPassword();
    const passwordHash = await this.auth.hashPassword(temporaryPassword);
    const loginId = input.loginId.toLowerCase();
    try {
      const userId = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            role: 'SUBSCRIBER',
            name: input.name,
            email: input.email?.toLowerCase() ?? null,
            phone: input.phone ?? null,
            loginId,
            passwordHash,
            mustChangePassword: true,
            tempPasswordExpiresAt: new Date(now.getTime() + TEMP_PASSWORD_HOURS * 3_600_000),
            notes: input.notes ?? null,
            createdById: requireActor(actor),
          },
        });
        const subscription = await tx.subscription.create({
          data: { userId: user.id, startsAt: window.startsAt, expiresAt: window.expiresAt },
        });
        await tx.subscriptionEvent.create({
          data: {
            subscriptionId: subscription.id,
            type: 'CREATED',
            durationDays: input.durationDays,
            newStartsAt: window.startsAt,
            newExpiresAt: window.expiresAt,
            actorId: requireActor(actor),
            idempotencyKey: input.idempotencyKey,
          },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            action: 'SUBSCRIBER_CREATED',
            targetType: 'user',
            targetId: user.id,
            metadata: { loginId, durationDays: input.durationDays, expiresAt: window.expiresAt.toISOString() },
            requestId: actor.requestId,
          },
          tx,
        );
        return user.id;
      }, TX_OPTIONS);
      return { subscriber: await this.detail(userId), temporaryPassword, replayed: false };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // A parallel copy of this same request hits the login ID constraint first, so the key decides.
      const again = await this.prisma.subscriptionEvent.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { subscription: { select: { userId: true } } },
      });
      if (again) {
        return { subscriber: await this.detail(again.subscription.userId), temporaryPassword: null, replayed: true };
      }
      if (isUniqueViolation(error, 'login_id')) {
        throw new AppError(409, 'LOGIN_ID_TAKEN', 'That login ID is already in use.');
      }
      throw error;
    }
  }

  /** A date of today means "from now"; a later date means from that local midnight. */
  private activationInstant(date: string, tz: string, now: Date): Date {
    let instant: Date;
    try {
      instant = localDateToInstant(date, tz);
    } catch {
      throw new AppError(422, 'VALIDATION', 'That activation date is not valid.');
    }
    const endOfThatDay = endOfLocalDateExclusive(date, tz);
    if (endOfThatDay.getTime() <= now.getTime()) {
      throw new AppError(422, 'ACTIVATION_IN_PAST', 'The activation date cannot be in the past.');
    }
    return instant.getTime() <= now.getTime() ? now : instant;
  }

  async update(id: string, input: z.infer<typeof updateSubscriberSchema>, actor: Actor) {
    const row = await this.prisma.user.findFirst({ where: { id, role: 'SUBSCRIBER' } });
    if (!row) throw notFound('Subscriber not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          ...input,
          ...(input.email !== undefined ? { email: input.email?.toLowerCase() ?? null } : {}),
        },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'SUBSCRIBER_UPDATED',
          targetType: 'user',
          targetId: id,
          metadata: { fields: Object.keys(input) },
          requestId: actor.requestId,
        },
        tx,
      );
    });
    return this.detail(id);
  }

  async renew(id: string, input: z.infer<typeof renewSubscriptionSchema>, actor: Actor) {
    const replay = await this.prisma.subscriptionEvent.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (replay) return { subscriber: await this.detail(id), replayed: true };
    const tz = await this.settings.timezone();
    try {
      await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT s.id FROM subscriptions s JOIN users u ON u.id = s.user_id
          WHERE s.user_id = ${id}::uuid AND u.role = 'SUBSCRIBER' FOR UPDATE OF s`;
        if (locked.length === 0) throw notFound('Subscriber not found');
        const current = await tx.subscription.findUniqueOrThrow({ where: { userId: id } });
        const renewal = computeRenewal(current, input.durationDays, new Date(), tz);
        await tx.subscription.update({
          where: { id: current.id },
          data: { startsAt: renewal.startsAt, expiresAt: renewal.expiresAt },
        });
        await tx.subscriptionEvent.create({
          data: {
            subscriptionId: current.id,
            type: 'RENEWED',
            mode: renewal.mode,
            durationDays: input.durationDays,
            previousStartsAt: current.startsAt,
            previousExpiresAt: current.expiresAt,
            newStartsAt: renewal.startsAt,
            newExpiresAt: renewal.expiresAt,
            note: input.note,
            actorId: requireActor(actor),
            idempotencyKey: input.idempotencyKey,
          },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            action: 'SUBSCRIPTION_RENEWED',
            targetType: 'user',
            targetId: id,
            metadata: {
              mode: renewal.mode,
              durationDays: input.durationDays,
              from: current.expiresAt.toISOString(),
              to: renewal.expiresAt.toISOString(),
            },
            requestId: actor.requestId,
          },
          tx,
        );
        await this.auth.notifyAccessChange(tx, id);
      }, TX_OPTIONS);
    } catch (error) {
      if (!isUniqueViolation(error, 'idempotency_key')) throw error;
      return { subscriber: await this.detail(id), replayed: true };
    }
    return { subscriber: await this.detail(id), replayed: false };
  }

  async adjust(id: string, input: z.infer<typeof adjustSubscriptionSchema>, actor: Actor) {
    const replay = await this.prisma.subscriptionEvent.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (replay) return { subscriber: await this.detail(id), replayed: true };
    if (input.lastValidDate && input.expiresAt) {
      throw new AppError(422, 'VALIDATION', 'Give either a last valid date or an exact end time, not both.');
    }
    if (!input.lastValidDate && !input.expiresAt && !input.activationDate) {
      throw new AppError(422, 'VALIDATION', 'Say which date is changing.');
    }
    const tz = await this.settings.timezone();
    try {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.subscription.findFirst({ where: { userId: id, user: { role: 'SUBSCRIBER' } } });
        if (!current) throw notFound('Subscriber not found');
        const startsAt = input.activationDate ? localDateToInstant(input.activationDate, tz) : current.startsAt;
        const expiresAt = input.expiresAt
          ? new Date(input.expiresAt)
          : input.lastValidDate
            ? endOfLocalDateExclusive(input.lastValidDate, tz)
            : current.expiresAt;
        if (expiresAt.getTime() <= startsAt.getTime()) {
          throw new AppError(422, 'VALIDATION', 'The subscription must end after it starts.');
        }
        await tx.subscription.update({ where: { id: current.id }, data: { startsAt, expiresAt } });
        await tx.subscriptionEvent.create({
          data: {
            subscriptionId: current.id,
            type: 'ADJUSTED',
            previousStartsAt: current.startsAt,
            previousExpiresAt: current.expiresAt,
            newStartsAt: startsAt,
            newExpiresAt: expiresAt,
            note: input.note,
            actorId: requireActor(actor),
            idempotencyKey: input.idempotencyKey,
          },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            action: 'SUBSCRIPTION_ADJUSTED',
            targetType: 'user',
            targetId: id,
            metadata: { note: input.note, from: current.expiresAt.toISOString(), to: expiresAt.toISOString() },
            requestId: actor.requestId,
          },
          tx,
        );
        await this.auth.notifyAccessChange(tx, id);
      }, TX_OPTIONS);
    } catch (error) {
      if (error instanceof RangeError) throw new AppError(422, 'VALIDATION', 'That date is not valid.');
      if (!isUniqueViolation(error, 'idempotency_key')) throw error;
      return { subscriber: await this.detail(id), replayed: true };
    }
    return { subscriber: await this.detail(id), replayed: false };
  }

  private async requireSubscriber(id: string) {
    const row = await this.prisma.user.findFirst({ where: { id, role: 'SUBSCRIBER' } });
    if (!row) throw notFound('Subscriber not found');
    return row;
  }

  async setStatus(id: string, status: 'ACTIVE' | 'SUSPENDED' | 'DISABLED', note: string | undefined, actor: Actor) {
    await this.requireSubscriber(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { status } });
      if (status !== 'ACTIVE') await this.auth.revokeAllSessions(id, tx);
      else await this.auth.notifyAccessChange(tx, id);
      await this.audit.record(
        {
          actorId: actor.id,
          action: `SUBSCRIBER_${status}`,
          targetType: 'user',
          targetId: id,
          metadata: { note },
          requestId: actor.requestId,
        },
        tx,
      );
    });
    return this.detail(id);
  }

  async resetPassword(id: string, actor: Actor) {
    const row = await this.requireSubscriber(id);
    const temporaryPassword = newTemporaryPassword();
    const passwordHash = await this.auth.hashPassword(temporaryPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          passwordHash,
          mustChangePassword: true,
          tempPasswordExpiresAt: new Date(Date.now() + TEMP_PASSWORD_HOURS * 3_600_000),
        },
      });
      await this.auth.revokeAllSessions(id, tx);
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'PASSWORD_RESET_BY_ADMIN',
          targetType: 'user',
          targetId: id,
          requestId: actor.requestId,
        },
        tx,
      );
    });
    return { loginId: row.loginId, temporaryPassword };
  }

  async revokeSessions(id: string, actor: Actor) {
    await this.requireSubscriber(id);
    const count = await this.prisma.$transaction(async (tx) => {
      const revoked = await this.auth.revokeAllSessions(id, tx);
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'SESSIONS_REVOKED_BY_ADMIN',
          targetType: 'user',
          targetId: id,
          metadata: { revoked },
          requestId: actor.requestId,
        },
        tx,
      );
      return revoked;
    });
    return { revoked: count };
  }
}
