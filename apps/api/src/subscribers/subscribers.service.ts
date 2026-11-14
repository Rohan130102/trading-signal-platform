import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  accessUntilLabel,
  adjustSubscriptionSchema,
  computeInitialWindow,
  computeRenewal,
  createSubscriberSchema,
  daysRemaining,
  endOfLocalDateExclusive,
  type EnquiryStatus,
  type grantTrialSchema,
  lastValidLocalDate,
  listRegistrationsQuery,
  listSubscribersQuery,
  localDateToInstant,
  previewStart,
  type RegistrationRow,
  renewSubscriptionSchema,
  screenshotsAllowedFor,
  type startSubscriptionSchema,
  subscriberActions,
  type SubscriptionKind,
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
import { enquiryOutcome } from '../enquiries/enquiries.service.js';
import { NoticesService } from '../notices/notices.service.js';
import { RESET_PASSWORD_HOURS } from '../registration/password-resets.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { Actor } from '../trades/trades.service.js';
import type { Tx } from '../db/prisma.service.js';

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
    private readonly notices: NoticesService,
  ) {}

  private present(row: Row, tz: string, screenshotsDefault: boolean, now = new Date()) {
    const sub = row.subscription;
    return {
      id: row.id,
      name: row.name,
      firstName: row.firstName,
      lastName: row.lastName,
      age: row.age,
      emailVerifiedAt: row.emailVerifiedAt?.toISOString() ?? null,
      selfRegistered: row.selfRegisteredAt !== null,
      enquiryStatus: row.enquiryStatus as EnquiryStatus,
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
        kind: (sub?.kind as SubscriptionKind | undefined) ?? null,
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
        trialGrants: { orderBy: { createdAt: 'desc' } },
        enquiries: { orderBy: { createdAt: 'desc' }, take: 20, include: { email: { select: { status: true } } } },
      },
    });
    if (!row) throw notFound('Subscriber not found');
    const now = new Date();
    return {
      ...this.present(row, tz, platform.screenshotsAllowedDefault, now),
      actions: subscriberActions(
        row.subscription ? { ...row.subscription, kind: row.subscription.kind as SubscriptionKind } : null,
        now,
      ),
      trials: row.trialGrants.map((t) => ({
        id: t.id,
        durationDays: t.durationDays,
        lastValidDate: lastValidLocalDate(t.expiresAt, tz),
        note: t.note,
        createdAt: t.createdAt.toISOString(),
      })),
      enquiries: row.enquiries.map((e) => ({
        id: e.id,
        channel: e.channel as 'WHATSAPP' | 'EMAIL',
        outcome: enquiryOutcome(e.channel, e.email?.status),
        createdAt: e.createdAt.toISOString(),
      })),
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
        await this.announceStart(tx, user.id, input.durationDays, window.expiresAt, tz, input.idempotencyKey);
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
        if (locked.length === 0) {
          const exists = await tx.user.count({ where: { id, role: 'SUBSCRIBER' } });
          if (!exists) throw notFound('Subscriber not found');
          throw new AppError(409, 'NO_SUBSCRIPTION', 'They have no subscription yet. Start one instead.');
        }
        const current = await tx.subscription.findUniqueOrThrow({ where: { userId: id } });
        if (current.kind === 'TRIAL') {
          throw new AppError(409, 'TRIAL_NOT_RENEWABLE', 'A trial is not renewed. Start a subscription instead.');
        }
        const now = new Date();
        const restartFrom = input.activationDate ? this.activationInstant(input.activationDate, tz, now) : undefined;
        const renewal = computeRenewal(current, input.durationDays, now, tz, restartFrom);
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
        const { serviceName } = await this.settings.get();
        await this.notices.notify(
          tx,
          {
            userId: id,
            kind: 'SUBSCRIPTION_RENEWED',
            title: 'Subscription Renewed',
            body: `Your subscription has been extended until ${accessUntilLabel(renewal.expiresAt, tz)}.`,
            dedupeKey: `renew:${input.idempotencyKey}`,
          },
          serviceName,
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
          tempPasswordExpiresAt: new Date(Date.now() + RESET_PASSWORD_HOURS * 3_600_000),
        },
      });
      // Any recovery request this person has open is answered by this password.
      await tx.passwordResetRequest.updateMany({
        where: { userId: id, status: 'OPEN' },
        data: { status: 'PASSWORD_ISSUED', issuedAt: new Date(), issuedById: actor.id },
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

  /** "Subscription Activated", in the app, by push and by email. Once per start, however often it is retried. */
  private async announceStart(tx: Tx, userId: string, days: number, expiresAt: Date, tz: string, key: string) {
    const { serviceName } = await this.settings.get();
    await this.notices.notify(
      tx,
      {
        userId,
        kind: 'SUBSCRIPTION_STARTED',
        title: 'Subscription Activated',
        body: `Your ${serviceName} subscription is active for ${days} ${days === 1 ? 'day' : 'days'}.\nValid until: ${accessUntilLabel(expiresAt, tz)}`,
        dedupeKey: `start:${key}`,
      },
      serviceName,
    );
  }

  /**
   * A paid window for someone with no access, an expired one, or a running trial. A running paid subscription is
   * renewed instead, and a start that would cut access short needs explicit confirmation.
   */
  async start(id: string, input: z.output<typeof startSubscriptionSchema>, actor: Actor) {
    const replay = await this.prisma.subscriptionEvent.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (replay) return { subscriber: await this.detail(id), replayed: true };
    const tz = await this.settings.timezone();
    try {
      await this.prisma.$transaction(async (tx) => {
        const user = await this.lockSubscriber(tx, id);
        const now = new Date();
        const current = user.subscription;
        if (current && current.kind === 'PAID' && current.expiresAt.getTime() > now.getTime()) {
          throw new AppError(409, 'SUBSCRIPTION_RUNNING', 'This subscription is still running. Renew it instead.');
        }
        const startsAt = input.activationDate ? this.activationInstant(input.activationDate, tz, now) : now;
        const window = previewStart(current, startsAt, input.durationDays, now, tz);
        if (window.shortensAccess && !input.confirmShorter) {
          throw new AppError(
            409,
            'SHORTENS_ACCESS',
            `This ends on ${accessUntilLabel(window.expiresAt, tz)}, before the access they already have. Confirm to continue.`,
          );
        }
        const subscription = current
          ? await tx.subscription.update({
              where: { id: current.id },
              data: { startsAt: window.startsAt, expiresAt: window.expiresAt, kind: 'PAID' },
            })
          : await tx.subscription.create({
              data: { userId: id, startsAt: window.startsAt, expiresAt: window.expiresAt, kind: 'PAID' },
            });
        await tx.subscriptionEvent.create({
          data: {
            subscriptionId: subscription.id,
            type: current ? 'STARTED' : 'CREATED',
            durationDays: input.durationDays,
            previousStartsAt: current?.startsAt ?? null,
            previousExpiresAt: current?.expiresAt ?? null,
            newStartsAt: window.startsAt,
            newExpiresAt: window.expiresAt,
            note: input.note,
            actorId: requireActor(actor),
            idempotencyKey: input.idempotencyKey,
          },
        });
        await tx.user.updateMany({
          where: { id, enquiryStatus: { in: ['INITIATED', 'UNDER_DISCUSSION'] } },
          data: { enquiryStatus: 'RESOLVED', enquiryUpdatedAt: now },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            action: 'SUBSCRIPTION_STARTED',
            targetType: 'user',
            targetId: id,
            metadata: {
              durationDays: input.durationDays,
              replacedKind: current?.kind ?? null,
              from: current?.expiresAt.toISOString() ?? null,
              to: window.expiresAt.toISOString(),
            },
            requestId: actor.requestId,
          },
          tx,
        );
        await this.announceStart(tx, id, input.durationDays, window.expiresAt, tz, input.idempotencyKey);
        await this.auth.notifyAccessChange(tx, id);
      }, TX_OPTIONS);
    } catch (error) {
      if (error instanceof RangeError) throw new AppError(422, 'VALIDATION', error.message);
      if (!isUniqueViolation(error, 'idempotency_key')) throw error;
      return { subscriber: await this.detail(id), replayed: true };
    }
    return { subscriber: await this.detail(id), replayed: false };
  }

  /**
   * A free trial: never automatic, never on top of running paid access, and a second one only on purpose. It gives
   * the same access as a subscription and is also kept as its own record for reporting and the one-time welcome.
   */
  async grantTrial(id: string, input: z.output<typeof grantTrialSchema>, actor: Actor) {
    const replay = await this.prisma.trialGrant.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (replay) return { subscriber: await this.detail(id), replayed: true };
    const tz = await this.settings.timezone();
    try {
      await this.prisma.$transaction(async (tx) => {
        const user = await this.lockSubscriber(tx, id);
        const now = new Date();
        const current = user.subscription;
        if (current && current.expiresAt.getTime() > now.getTime()) {
          throw new AppError(
            409,
            current.kind === 'TRIAL' ? 'TRIAL_RUNNING' : 'SUBSCRIPTION_RUNNING',
            current.kind === 'TRIAL'
              ? 'A trial is already running. It can be replaced by a subscription.'
              : 'They already have a running subscription.',
          );
        }
        const earlier = await tx.trialGrant.count({ where: { userId: id } });
        if (earlier > 0 && !input.allowRepeat) {
          throw new AppError(409, 'TRIAL_ALREADY_USED', 'They already had a free trial. Confirm to grant another.');
        }
        const startsAt = input.activationDate ? this.activationInstant(input.activationDate, tz, now) : now;
        const window = computeInitialWindow(startsAt, input.durationDays, tz);
        const subscription = current
          ? await tx.subscription.update({
              where: { id: current.id },
              data: { startsAt: window.startsAt, expiresAt: window.expiresAt, kind: 'TRIAL' },
            })
          : await tx.subscription.create({
              data: { userId: id, startsAt: window.startsAt, expiresAt: window.expiresAt, kind: 'TRIAL' },
            });
        const grant = await tx.trialGrant.create({
          data: {
            id: randomUUID(),
            userId: id,
            durationDays: input.durationDays,
            startsAt: window.startsAt,
            expiresAt: window.expiresAt,
            note: input.note,
            actorId: requireActor(actor),
            idempotencyKey: input.idempotencyKey,
          },
        });
        await tx.subscriptionEvent.create({
          data: {
            subscriptionId: subscription.id,
            type: 'TRIAL_GRANTED',
            durationDays: input.durationDays,
            previousStartsAt: current?.startsAt ?? null,
            previousExpiresAt: current?.expiresAt ?? null,
            newStartsAt: window.startsAt,
            newExpiresAt: window.expiresAt,
            note: input.note,
            actorId: requireActor(actor),
            idempotencyKey: `trial:${input.idempotencyKey}`,
          },
        });
        await tx.user.updateMany({
          where: { id, enquiryStatus: { in: ['INITIATED', 'UNDER_DISCUSSION'] } },
          data: { enquiryStatus: 'RESOLVED', enquiryUpdatedAt: now },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            action: 'TRIAL_GRANTED',
            targetType: 'user',
            targetId: id,
            metadata: {
              grantId: grant.id,
              durationDays: input.durationDays,
              repeat: earlier > 0,
              to: window.expiresAt.toISOString(),
            },
            requestId: actor.requestId,
          },
          tx,
        );
        const { serviceName } = await this.settings.get();
        await this.notices.notify(
          tx,
          {
            userId: id,
            kind: 'TRIAL_GRANTED',
            title: 'Your Free Trial Is Ready!',
            body: `You've received ${input.durationDays} ${input.durationDays === 1 ? 'day' : 'days'} of access to ${serviceName}, until ${accessUntilLabel(window.expiresAt, tz)}.\nEnjoy exploring your signals.`,
            dedupeKey: `trial:${grant.id}`,
          },
          serviceName,
        );
        await this.auth.notifyAccessChange(tx, id);
      }, TX_OPTIONS);
    } catch (error) {
      if (error instanceof RangeError) throw new AppError(422, 'VALIDATION', error.message);
      if (!isUniqueViolation(error, 'idempotency_key')) throw error;
      return { subscriber: await this.detail(id), replayed: true };
    }
    return { subscriber: await this.detail(id), replayed: false };
  }

  /** Serialises subscription changes for one person, so two administrators cannot both start one. */
  private async lockSubscriber(tx: Tx, id: string) {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM users WHERE id = ${id}::uuid AND role = 'SUBSCRIBER' FOR UPDATE`;
    if (locked.length === 0) throw notFound('Subscriber not found');
    return tx.user.findUniqueOrThrow({ where: { id }, include: { subscription: true } });
  }

  /** People who signed themselves up, newest first. */
  async registrations(query: z.output<typeof listRegistrationsQuery>) {
    const tz = await this.settings.timezone();
    const now = new Date();
    const q = query.q?.trim();
    const accessFilter: Record<string, Prisma.UserWhereInput> = {
      NONE: { subscription: { is: null } },
      TRIAL: { subscription: { kind: 'TRIAL', startsAt: { lte: now }, expiresAt: { gt: now } } },
      ACTIVE: { subscription: { kind: 'PAID', startsAt: { lte: now }, expiresAt: { gt: now } } },
      EXPIRED: { subscription: { expiresAt: { lte: now } } },
    };
    const where: Prisma.UserWhereInput = {
      role: 'SUBSCRIBER',
      selfRegisteredAt: { not: null },
      ...(query.enquiry ? { enquiryStatus: query.enquiry } : {}),
      ...(query.unseen === 'true' ? { registrationSeenAt: null } : {}),
      ...(query.access ? accessFilter[query.access] : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
              { phone: { contains: q } },
            ],
          }
        : {}),
    };
    const [rows, total, unseen] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: { subscription: true },
        orderBy: { selfRegisteredAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.user.count({ where }),
      this.prisma.user.count({
        where: { role: 'SUBSCRIBER', selfRegisteredAt: { not: null }, registrationSeenAt: null },
      }),
    ]);
    const registrations: RegistrationRow[] = rows.map((r) => {
      const view = this.present(r, tz, false, now);
      return {
        id: r.id,
        name: r.name,
        email: r.email,
        mobile: r.phone,
        age: r.age,
        registeredAt: (r.selfRegisteredAt as Date).toISOString(),
        emailVerified: r.emailVerifiedAt !== null,
        enquiryStatus: r.enquiryStatus as EnquiryStatus,
        subscription: view.subscription,
        isNew: r.registrationSeenAt === null,
      };
    });
    return { registrations, total, unseen, page: query.page, pageSize: query.pageSize };
  }

  /** Opening a registration takes it off the badge for every administrator. */
  async markSeen(id: string) {
    const result = await this.prisma.user.updateMany({
      where: { id, role: 'SUBSCRIBER', registrationSeenAt: null },
      data: { registrationSeenAt: new Date() },
    });
    return { ok: true, marked: result.count > 0 };
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
