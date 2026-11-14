import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CH_ACCESS, CH_PUSH } from '../db/listener.service.js';
import { Prisma, PrismaService, type Tx } from '../db/prisma.service.js';
import { EmailService } from '../email/email.service.js';
import { noticeEmail } from '../email/messages.js';
import { PushTransport } from '../notifications/push-transport.js';

export type NoticeKind = 'SUBSCRIPTION_STARTED' | 'SUBSCRIPTION_RENEWED' | 'TRIAL_GRANTED';

export interface NoticeInput {
  userId: string;
  kind: NoticeKind;
  title: string;
  body: string;
  /** One notice per key, whatever retries happen. */
  dedupeKey: string;
}

/**
 * Messages to one person about their own account: in the app, by push to their signed-in devices, and by email.
 * They carry no signal content, so they also reach someone whose access has ended. Created in the transaction
 * of the change they report, so they exist exactly when it does.
 */
@Injectable()
export class NoticesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly transport: PushTransport,
  ) {}

  async notify(tx: Tx, notice: NoticeInput, serviceName: string): Promise<boolean> {
    const id = randomUUID();
    const inserted = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO user_notices (id, user_id, kind, title, body, dedupe_key)
      VALUES (${id}::uuid, ${notice.userId}::uuid, ${notice.kind}, ${notice.title}, ${notice.body}, ${notice.dedupeKey})
      ON CONFLICT (dedupe_key) DO NOTHING
      RETURNING id`;
    if (inserted.length === 0) return false;

    const channels = [
      this.transport.webAvailable ? "'WEB_PUSH'" : null,
      this.transport.nativeAvailable ? "'EXPO'" : null,
    ].filter(Boolean);
    if (channels.length > 0) {
      const pushed = await tx.$executeRaw`
        INSERT INTO push_deliveries (id, notice_id, push_subscription_id, user_id, status, next_attempt_at, updated_at)
        SELECT gen_random_uuid(), ${id}::uuid, ps.id, ps.user_id, 'PENDING', now(), now()
        FROM push_subscriptions ps
        JOIN users u ON u.id = ps.user_id AND u.status = 'ACTIVE'
        JOIN sessions s ON s.id = ps.session_id AND s.revoked_at IS NULL AND s.expires_at > now()
        WHERE ps.user_id = ${notice.userId}::uuid AND ps.invalidated_at IS NULL
          AND ps.channel::text IN (${Prisma.raw(channels.join(', '))})
        ON CONFLICT DO NOTHING`;
      if (pushed > 0) await tx.$executeRaw`SELECT pg_notify(${CH_PUSH}, '')`;
    }

    const user = await tx.user.findUniqueOrThrow({ where: { id: notice.userId }, select: { email: true } });
    if (user.email && this.email.available) {
      await this.email.enqueue(tx, {
        kind: `notice:${notice.kind}`,
        ...noticeEmail(user.email, serviceName, notice.title, notice.body),
        userId: notice.userId,
        dedupeKey: `notice:${notice.dedupeKey}`,
      });
    }
    // Their open app reloads its account state, and with it the new notice.
    await tx.$executeRaw`SELECT pg_notify(${CH_ACCESS}, ${notice.userId})`;
    return true;
  }

  async list(userId: string, limit = 30) {
    const rows = await this.prisma.userNotice.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      body: r.body,
      createdAt: r.createdAt.toISOString(),
      read: r.readAt !== null,
    }));
  }

  async markRead(userId: string): Promise<number> {
    const result = await this.prisma.userNotice.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count;
  }
}
