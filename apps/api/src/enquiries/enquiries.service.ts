import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  ENQUIRY_STATUS_LABELS,
  type EnquiryOutcome,
  type EnquiryStatus,
  enquiryMessage,
  type enquirySchema,
  subscriptionState,
  whatsappAppLink,
  whatsappWebLink,
} from '@signaldesk/domain';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { RateLimitService } from '../auth/rate-limit.service.js';
import { AppError, notFound } from '../common/http.js';
import { isUniqueViolation, PrismaService, TX_OPTIONS } from '../db/prisma.service.js';
import { EmailService } from '../email/email.service.js';
import { enquiryEmail } from '../email/messages.js';
import { SettingsService } from '../settings/settings.service.js';

type EnquiryInput = z.output<typeof enquirySchema>;

/** Within this time, another email enquiry is the same enquiry: repeated taps send nothing more. */
const EMAIL_REPEAT_WINDOW_MS = 10 * 60_000;
const ENQUIRIES_PER_HOUR = 10;

export function enquiryOutcome(channel: string, emailStatus: string | null | undefined): EnquiryOutcome {
  if (channel === 'WHATSAPP') return 'LINK_OPENED';
  if (emailStatus === 'SENT') return 'EMAIL_SENT';
  if (emailStatus === 'DEAD') return 'EMAIL_FAILED';
  return 'EMAIL_QUEUED';
}

/** First and last name for an enquiry. Older accounts only have a full name. */
export function splitName(user: { name: string; firstName: string | null; lastName: string | null }) {
  if (user.firstName || user.lastName) return { firstName: user.firstName ?? '', lastName: user.lastName ?? '' };
  const [first = '', ...rest] = user.name.trim().split(/\s+/);
  return { firstName: first, lastName: rest.join(' ') };
}

/**
 * Subscription enquiries. Opening WhatsApp is recorded as exactly that; only an email the provider accepted is
 * recorded as sent. The enquiry state moves from "not contacted" to "started" the first time.
 */
@Injectable()
export class EnquiriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
    private readonly limits: RateLimitService,
  ) {}

  async create(userId: string, input: EnquiryInput) {
    const replay = await this.prisma.subscriptionEnquiry.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { email: { select: { status: true } } },
    });
    if (replay) {
      if (replay.userId !== userId) throw notFound('Enquiry not found');
      return this.view(replay, true);
    }
    const settings = await this.settings.get();
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { subscription: true } });
    if (user.role !== 'SUBSCRIBER') throw new AppError(403, 'FORBIDDEN', 'Only subscribers send enquiries.');
    const key = `enquiry:${userId}`;
    if ((await this.limits.count(key, 3600)) >= ENQUIRIES_PER_HOUR) {
      throw new AppError(429, 'TOO_MANY_ATTEMPTS', 'Too many enquiries. Wait a while and try again.');
    }

    const person = {
      ...splitName(user),
      email: user.email ?? user.loginId,
      mobile: user.phone ?? 'Not provided',
    };
    const text = enquiryMessage(person, settings.serviceName, input.purpose);

    if (input.channel === 'EMAIL') {
      if (!(await this.email.available())) {
        throw new AppError(
          503,
          'EMAIL_NOT_CONFIGURED',
          'Email is not set up yet. Use WhatsApp or contact support directly.',
        );
      }
      const recent = await this.prisma.subscriptionEnquiry.findFirst({
        where: { userId, channel: 'EMAIL', createdAt: { gt: new Date(Date.now() - EMAIL_REPEAT_WINDOW_MS) } },
        include: { email: { select: { status: true } } },
        orderBy: { createdAt: 'desc' },
      });
      if (recent) return this.view(recent, true);
    }
    await this.limits.hit(key, 3600);

    const now = new Date();
    const tz = settings.businessTimezone;
    const id = randomUUID();
    try {
      await this.prisma.$transaction(async (tx) => {
        let emailId: bigint | null = null;
        if (input.channel === 'EMAIL') {
          emailId = await this.email.enqueue(tx, {
            kind: 'enquiry',
            ...enquiryEmail({
              to: settings.supportEmail,
              serviceName: settings.serviceName,
              replyTo: person.email,
              name: `${person.firstName} ${person.lastName}`.trim(),
              email: person.email,
              mobile: person.mobile,
              registeredAt: formatInstant(user.selfRegisteredAt ?? user.createdAt, tz),
              enquiredAt: formatInstant(now, tz),
              status: accountStatusText(user, now),
              purpose: input.purpose,
              source: input.whatsappUnavailable ? 'Email fallback (WhatsApp not installed)' : 'Email Fallback',
            }),
            userId,
            dedupeKey: `enquiry:${id}`,
          });
        }
        await tx.subscriptionEnquiry.create({
          data: {
            id,
            userId,
            channel: input.channel,
            purpose: input.purpose,
            whatsappUnavailable: input.whatsappUnavailable,
            emailId,
            idempotencyKey: input.idempotencyKey,
          },
        });
        await tx.user.updateMany({
          where: { id: userId, enquiryStatus: { in: ['NOT_CONTACTED', 'RESOLVED'] } },
          data: { enquiryStatus: 'INITIATED', enquiryUpdatedAt: now },
        });
        await this.audit.record(
          {
            actorId: userId,
            action: 'SUBSCRIPTION_ENQUIRY',
            targetType: 'user',
            targetId: userId,
            metadata: {
              channel: input.channel,
              purpose: input.purpose,
              whatsappUnavailable: input.whatsappUnavailable,
            },
          },
          tx,
        );
      }, TX_OPTIONS);
    } catch (error) {
      if (!isUniqueViolation(error, 'idempotency_key')) throw error;
    }
    const row = await this.prisma.subscriptionEnquiry.findUniqueOrThrow({
      where: { idempotencyKey: input.idempotencyKey },
      include: { email: { select: { status: true } } },
    });
    return {
      ...this.view(row, false),
      // Built from settings at this moment, so a changed number applies at once.
      whatsappLink: input.channel === 'WHATSAPP' ? whatsappWebLink(settings.supportWhatsapp, text) : null,
      whatsappAppLink: input.channel === 'WHATSAPP' ? whatsappAppLink(settings.supportWhatsapp, text) : null,
    };
  }

  async get(userId: string, id: string) {
    const row = await this.prisma.subscriptionEnquiry.findFirst({
      where: { id, userId },
      include: { email: { select: { status: true } } },
    });
    if (!row) throw notFound('Enquiry not found');
    return this.view(row, false);
  }

  private view(
    row: { id: string; channel: string; purpose: string; createdAt: Date; email: { status: string } | null },
    replayed: boolean,
  ) {
    return {
      id: row.id,
      channel: row.channel,
      purpose: row.purpose,
      outcome: enquiryOutcome(row.channel, row.email?.status),
      createdAt: row.createdAt.toISOString(),
      replayed,
      whatsappLink: null as string | null,
      whatsappAppLink: null as string | null,
    };
  }

  /** Administrators move an enquiry along. Recorded in the audit log with the before and after. */
  async setStatus(userId: string, status: EnquiryStatus, actor: { id: string; requestId?: string }) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, role: 'SUBSCRIBER' } });
    if (!user) throw notFound('Subscriber not found');
    if (user.enquiryStatus === status) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { enquiryStatus: status, enquiryUpdatedAt: new Date() } });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'ENQUIRY_STATUS_SET',
          targetType: 'user',
          targetId: userId,
          metadata: { from: user.enquiryStatus, to: status },
          requestId: actor.requestId,
        },
        tx,
      );
      await tx.$executeRaw`SELECT pg_notify('access_changes', ${userId})`;
    });
  }
}

function formatInstant(at: Date, tz: string): string {
  return `${at.toLocaleString('en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' })} (${tz})`;
}

function accountStatusText(
  user: { enquiryStatus: string; subscription: { startsAt: Date; expiresAt: Date; kind: string } | null },
  now: Date,
): string {
  const state = subscriptionState(user.subscription, now);
  const access =
    state === 'ACTIVE'
      ? user.subscription?.kind === 'TRIAL'
        ? 'Free trial active'
        : 'Subscription active'
      : state === 'EXPIRED'
        ? user.subscription?.kind === 'TRIAL'
          ? 'Free trial ended'
          : 'Subscription expired'
        : state === 'SCHEDULED'
          ? 'Subscription starts later'
          : 'No active subscription';
  return `${access}; enquiry: ${ENQUIRY_STATUS_LABELS[user.enquiryStatus as EnquiryStatus] ?? user.enquiryStatus}`;
}
