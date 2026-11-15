import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  BADGE_CAP,
  eventCategory,
  type EventType,
  evaluateSignalAccess,
  mobileDeepLinkPath,
  pushPresentation,
} from '@signaldesk/domain';
import { AnnouncementsService } from '../announcements/announcements.service.js';
import { log } from '../common/log.js';
import { env } from '../config/env.js';
import { CH_EVENTS, CH_PUSH, ListenerService } from '../db/listener.service.js';
import { Prisma, PrismaService } from '../db/prisma.service.js';
import { AudienceService } from '../feed/audience.service.js';
import { TradesService } from '../trades/trades.service.js';
import { CH_EMAIL, EmailService } from '../email/email.service.js';
import { EmailChallengeService } from '../registration/email-challenge.service.js';
import { NotificationsService } from './notifications.service.js';
import {
  EXPO_BATCH_LIMIT,
  PUSH_TTL_SECONDS,
  type PushMessage,
  type PushResult,
  type PushTarget,
  PushTransport,
} from './push-transport.js';

const OUTBOX_MAX_ATTEMPTS = 8;
const PUSH_MAX_ATTEMPTS = 6;
/** One claim always fits in a single request to Expo. */
const PUSH_BATCH = EXPO_BATCH_LIMIT;
const PUSH_CONCURRENCY = 20;

const DELIVERY_INCLUDE = {
  event: {
    select: {
      id: true,
      seq: true,
      tradeId: true,
      tradeVersion: true,
      title: true,
      body: true,
      type: true,
      priority: true,
      createdAt: true,
      payload: true,
    },
  },
  notice: { select: { id: true, kind: true, title: true, body: true, createdAt: true } },
  pushSubscription: {
    include: {
      session: true,
      user: { include: { subscription: true, preferences: true } },
    },
  },
} satisfies Prisma.PushDeliveryInclude;

type DeliveryRow = Prisma.PushDeliveryGetPayload<{ include: typeof DELIVERY_INCLUDE }>;

interface PreparedPush {
  delivery: DeliveryRow;
  target: PushTarget;
  message: PushMessage;
}

export function retryDelayMs(attempt: number): number {
  return Math.min(5 * 60_000, 2000 * 2 ** Math.max(0, attempt - 1));
}

interface ClaimedOutbox {
  id: bigint;
  event_id: string;
  attempts: number;
}

/**
 * Durable background processing on PostgreSQL. Rows are claimed with SKIP LOCKED, so any number of
 * workers can run; an expired claim is picked up again after a crash. Processing is idempotent,
 * so a repeat after a crash cannot create a second logical delivery.
 */
@Injectable()
export class WorkerService implements OnModuleDestroy {
  private readonly workerId = `${env.INSTANCE_ID}-worker`;
  private running = false;
  private timers: NodeJS.Timeout[] = [];
  private outboxBusy = false;
  private outboxAgain = false;
  private pushBusy = false;
  private pushAgain = false;
  private emailBusy = false;
  private emailAgain = false;
  private lastPurge = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly listener: ListenerService,
    private readonly transport: PushTransport,
    private readonly trades: TradesService,
    private readonly announcements: AnnouncementsService,
    private readonly notifications: NotificationsService,
    private readonly audience: AudienceService,
    private readonly email: EmailService,
    private readonly challenges: EmailChallengeService,
  ) {}

  private lastBacklogAlert = { at: 0, text: '' };

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const startedAt = new Date();
    this.listener.on(CH_EVENTS, () => void this.runOutbox());
    this.listener.on(CH_PUSH, () => void this.runPush());
    this.listener.on(CH_EMAIL, () => void this.runEmail());
    await this.listener.start();

    const beat = async () => {
      await this.prisma.workerHeartbeat.upsert({
        where: { workerId: this.workerId },
        create: { workerId: this.workerId, startedAt, lastSeenAt: new Date() },
        update: { lastSeenAt: new Date() },
      });
    };
    const guarded = (name: string, fn: () => Promise<unknown>) => () => {
      fn().catch((error: Error) => log('error', `${name}_failed`, { error: error.message }));
    };
    await beat().catch(() => undefined);
    this.timers.push(
      setInterval(guarded('heartbeat', beat), 5000),
      setInterval(() => void this.runOutbox(), env.WORKER_POLL_MS),
      setInterval(() => void this.runPush(), env.WORKER_POLL_MS),
      setInterval(() => void this.runEmail(), env.WORKER_POLL_MS),
      setInterval(
        guarded('expo_receipts', () => this.checkExpoReceipts()),
        env.EXPO_RECEIPT_POLL_SECONDS * 1000,
      ),
      setInterval(
        guarded('sweep', () => this.sweep()),
        15_000,
      ),
      // Scheduled announcements go out within a few seconds of their time.
      setInterval(
        guarded('scheduled_announcements', () => this.announcements.publishDue()),
        5000,
      ),
      setInterval(
        guarded('backlog_check', () => this.checkBacklog()),
        30_000,
      ),
    );
    void this.runOutbox();
    void this.runPush();
    log('info', 'worker_started', { workerId: this.workerId, transport: this.transport.mode });
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  private async runOutbox(): Promise<void> {
    if (!this.running) return;
    if (this.outboxBusy) {
      this.outboxAgain = true;
      return;
    }
    this.outboxBusy = true;
    try {
      do {
        this.outboxAgain = false;
        while ((await this.processOutboxBatch()) > 0 && this.running);
      } while (this.outboxAgain && this.running);
    } catch (error) {
      log('warn', 'outbox_batch_failed', { error: (error as Error).message });
    } finally {
      this.outboxBusy = false;
    }
  }

  private async processOutboxBatch(): Promise<number> {
    const claimed = await this.prisma.$queryRaw<ClaimedOutbox[]>`
      UPDATE outbox_events SET status = 'PROCESSING', locked_at = now(), locked_by = ${this.workerId}, attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM outbox_events
        WHERE (status = 'PENDING' AND available_at <= now())
           OR (status = 'PROCESSING' AND locked_at < now() - make_interval(secs => ${env.WORKER_LOCK_TIMEOUT_SECONDS}::double precision))
        ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 20
      )
      RETURNING id, event_id, attempts`;
    for (const job of claimed) {
      try {
        await this.expandEvent(job.event_id);
        await this.prisma.outboxEvent.update({
          where: { id: job.id },
          data: { status: 'DONE', processedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null },
        });
      } catch (error) {
        const message = (error as Error).message.slice(0, 500);
        const dead = job.attempts >= OUTBOX_MAX_ATTEMPTS;
        log(dead ? 'error' : 'warn', dead ? 'outbox_dead_letter' : 'outbox_retry', {
          eventId: job.event_id,
          error: message,
        });
        await this.prisma.outboxEvent.update({
          where: { id: job.id },
          data: {
            status: dead ? 'DEAD' : 'PENDING',
            availableAt: new Date(Date.now() + retryDelayMs(job.attempts)),
            lockedAt: null,
            lockedBy: null,
            lastError: message,
          },
        });
      }
    }
    return claimed.length;
  }

  /**
   * One row per eligible device. The unique key makes a repeat of this step harmless. An alert about a trade goes
   * only to members who may see that trade (the audience rule), so nobody is told about an update without its signal.
   */
  private async expandEvent(eventId: string): Promise<void> {
    const event = await this.prisma.signalEvent.findUniqueOrThrow({
      where: { id: eventId },
      select: {
        type: true,
        tradeId: true,
        trade: { select: { publishedAt: true, removal: { select: { tradeId: true } } } },
      },
    });
    if (!this.transport.available) return;
    if (event.trade?.removal) return;
    let followers = Prisma.sql`true`;
    if (event.tradeId) {
      const candidates = await this.prisma.pushSubscription.findMany({
        where: { invalidatedAt: null, user: { role: 'SUBSCRIBER' } },
        select: { userId: true },
        distinct: ['userId'],
      });
      const allowed = await this.audience.mayFollowTrade(
        candidates.map((c) => c.userId),
        event.trade?.publishedAt ?? null,
      );
      followers = Prisma.sql`u.id = ANY(${allowed}::uuid[])`;
    }
    const category = eventCategory(event.type as EventType);
    const preference = Prisma.raw(
      {
        NEW_SIGNAL: 'COALESCE(np.push_new_signals, true)',
        UPDATE: 'COALESCE(np.push_updates, true)',
        CLOSURE: 'COALESCE(np.push_closures, true)',
        ANNOUNCEMENT: 'COALESCE(np.push_announcements, true)',
      }[category],
    );
    const channelAllowed = Prisma.raw(
      [this.transport.webAvailable ? "'WEB_PUSH'" : null, this.transport.nativeAvailable ? "'EXPO'" : null]
        .filter(Boolean)
        .map((name) => `ps.channel = ${name}`)
        .join(' OR ')
        .replace(/^(.*)$/, '($1)'),
    );
    const inserted = await this.prisma.$executeRaw`
      INSERT INTO push_deliveries (id, event_id, push_subscription_id, user_id, status, next_attempt_at, updated_at)
      SELECT gen_random_uuid(), ${eventId}::uuid, ps.id, ps.user_id, 'PENDING', now(), now()
      FROM push_subscriptions ps
      JOIN users u ON u.id = ps.user_id AND u.status = 'ACTIVE'
      JOIN sessions s ON s.id = ps.session_id AND s.revoked_at IS NULL AND s.expires_at > now()
      LEFT JOIN subscriptions sub ON sub.user_id = u.id
      LEFT JOIN notification_preferences np ON np.user_id = u.id
      WHERE ps.invalidated_at IS NULL
        AND ${channelAllowed}
        AND ${preference}
        AND (u.role = 'ADMIN' OR (sub.starts_at <= now() AND sub.expires_at > now() AND ${followers}))
      ON CONFLICT (event_id, push_subscription_id) DO NOTHING`;
    if (inserted > 0) void this.runPush();
  }

  private async runEmail(): Promise<void> {
    if (!this.running) return;
    if (this.emailBusy) {
      this.emailAgain = true;
      return;
    }
    this.emailBusy = true;
    try {
      do {
        this.emailAgain = false;
        while ((await this.email.processBatch()) > 0 && this.running);
      } while (this.emailAgain && this.running);
    } catch (error) {
      log('warn', 'email_batch_failed', { error: (error as Error).message });
    } finally {
      this.emailBusy = false;
    }
  }

  private async runPush(): Promise<void> {
    if (!this.running) return;
    if (this.pushBusy) {
      this.pushAgain = true;
      return;
    }
    this.pushBusy = true;
    try {
      do {
        this.pushAgain = false;
        while ((await this.processPushBatch()) > 0 && this.running);
      } while (this.pushAgain && this.running);
    } catch (error) {
      log('warn', 'push_batch_failed', { error: (error as Error).message });
    } finally {
      this.pushBusy = false;
    }
  }

  private async processPushBatch(): Promise<number> {
    const claimed = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE push_deliveries SET status = 'SENDING', locked_at = now(), attempts = attempts + 1, updated_at = now()
      WHERE id IN (
        SELECT id FROM push_deliveries
        WHERE (status IN ('PENDING', 'RETRY') AND next_attempt_at <= now())
           OR (status = 'SENDING' AND locked_at < now() - make_interval(secs => ${env.WORKER_LOCK_TIMEOUT_SECONDS}::double precision))
        ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT ${PUSH_BATCH}
      )
      RETURNING id`;
    const ids = claimed.map((c) => c.id);
    if (ids.length === 0) return 0;
    try {
      const deliveries = await this.prisma.pushDelivery.findMany({
        where: { id: { in: ids } },
        include: DELIVERY_INCLUDE,
      });
      const now = new Date();
      const web: PreparedPush[] = [];
      const expo: PreparedPush[] = [];
      const badges = await this.unreadByUser([...new Set(deliveries.map((d) => d.userId))]);
      for (const delivery of deliveries) {
        const prepared = await this.prepare(delivery, now, badges.get(delivery.userId));
        if (prepared) (prepared.target.channel === 'EXPO' ? expo : web).push(prepared);
      }
      await Promise.all([this.sendWebPushes(web), this.sendExpoPushes(expo)]);
    } catch (error) {
      await this.releaseForRetry(ids, error);
    }
    return claimed.length;
  }

  private async sendWebPushes(items: PreparedPush[]): Promise<void> {
    const queue = [...items];
    await Promise.all(
      Array.from({ length: Math.min(PUSH_CONCURRENCY, queue.length) }, async () => {
        for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
          try {
            await this.recordResult(item.delivery, await this.transport.send(item.target, item.message));
          } catch (error) {
            await this.releaseForRetry([item.delivery.id], error);
          }
        }
      }),
    );
  }

  /** Expo takes a whole batch in one request, so the last phone is not left waiting behind the first. */
  private async sendExpoPushes(items: PreparedPush[]): Promise<void> {
    if (items.length === 0) return;
    let results: PushResult[];
    try {
      results = await this.transport.sendExpoBatch(
        items.map(({ target, message }) => ({ token: target.endpoint, message })),
      );
    } catch (error) {
      await this.releaseForRetry(
        items.map((item) => item.delivery.id),
        error,
      );
      return;
    }
    const pairs = items.map((item, index) => ({ delivery: item.delivery, result: results[index] as PushResult }));
    const accepted = pairs.filter(
      (pair): pair is { delivery: DeliveryRow; result: Extract<PushResult, { kind: 'ACCEPTED' }> } =>
        pair.result.kind === 'ACCEPTED',
    );
    try {
      await this.recordAccepted(accepted);
    } catch (error) {
      await this.releaseForRetry(
        accepted.map((pair) => pair.delivery.id),
        error,
      );
    }
    for (const { delivery, result } of pairs) {
      if (result.kind === 'ACCEPTED') continue;
      try {
        await this.recordResult(delivery, result);
      } catch (error) {
        await this.releaseForRetry([delivery.id], error);
      }
    }
  }

  /** A failure on some rows must not strand them until their claims expire. */
  private async releaseForRetry(ids: string[], error: unknown): Promise<void> {
    if (ids.length === 0) return;
    const message = (error as Error).message.slice(0, 200);
    log('warn', 'push_delivery_failed', { count: ids.length, error: message });
    await this.prisma.pushDelivery
      .updateMany({
        where: { id: { in: ids }, status: 'SENDING' },
        data: { status: 'RETRY', nextAttemptAt: new Date(Date.now() + 30_000), lastError: message, lockedAt: null },
      })
      .catch(() => undefined);
  }

  /** Decides whether this delivery should still be sent. If not, it is finished here and null comes back. */
  /** One query for the whole batch: each person's unread count for the app icon badge, as the app counts it. */
  private async unreadByUser(userIds: string[]): Promise<Map<string, number>> {
    const counts = await this.audience.unreadCounts(userIds);
    return new Map([...counts].map(([id, unread]) => [id, Math.min(BADGE_CAP, unread)]));
  }

  /** Logs a warning a log alerting rule can page on, at most every five minutes while the problem lasts. */
  private async checkBacklog(): Promise<void> {
    const alerts = await this.notifications.alerts();
    if (alerts.length === 0) {
      this.lastBacklogAlert = { at: 0, text: '' };
      return;
    }
    const text = alerts.join(' | ');
    if (text === this.lastBacklogAlert.text && Date.now() - this.lastBacklogAlert.at < 5 * 60_000) return;
    this.lastBacklogAlert = { at: Date.now(), text };
    log('warn', 'notification_backlog', { alerts });
  }

  private async prepare(delivery: DeliveryRow, now: Date, badge?: number): Promise<PreparedPush | null> {
    const { id, event, notice, pushSubscription: device } = delivery;
    const { user, session } = device;
    if (!event) return notice ? this.prepareNotice(delivery, notice, now, badge) : null;

    // Checked again immediately before sending: access may have ended since the job was queued.
    const access = evaluateSignalAccess(user, user.subscription, now);
    const sessionLive = session !== null && session.revokedAt === null && session.expiresAt > now;
    if (!access.allowed || !sessionLive || device.invalidatedAt) {
      await this.finish(id, 'SKIPPED', null, access.allowed ? 'Device signed out' : `Access ended: ${access.reason}`);
      return null;
    }
    if (now.getTime() - event.createdAt.getTime() > PUSH_TTL_SECONDS * 1000) {
      await this.finish(id, 'FAILED', null, 'Too old to be useful');
      return null;
    }

    const hide = user.preferences?.hidePreview ?? false;
    const category = eventCategory(event.type as EventType);
    const announcementCategory = (event.payload as { category?: string } | null)?.category ?? null;
    const presentation = pushPresentation(event.type as EventType, category, event.priority, announcementCategory);
    const message: PushMessage = {
      title: hide ? 'New update' : event.title,
      body: hide ? 'Open the app to read it.' : event.body.split('\n').slice(0, 4).join('\n').slice(0, 1000),
      url: event.tradeId ? `/app/trades/${event.tradeId}` : '/app',
      path: mobileDeepLinkPath(event.tradeId, category),
      tag: event.id,
      urgent: presentation.urgent,
      androidChannel: presentation.androidChannel,
      interruptionLevel: presentation.interruptionLevel,
      badge,
      threadId: event.tradeId ?? 'announcements',
      data: {
        tradeId: event.tradeId,
        seq: Number(event.seq),
        tradeVersion: event.tradeVersion,
        category,
        priority: event.priority,
        // Left out when previews are hidden: the direction is part of the signal.
        direction:
          !hide && category === 'NEW_SIGNAL'
            ? ((event.payload as { direction?: string } | null)?.direction ?? null)
            : null,
      },
    };
    const target: PushTarget =
      device.channel === 'EXPO'
        ? { channel: 'EXPO', endpoint: device.endpoint }
        : {
            channel: 'WEB_PUSH',
            endpoint: device.endpoint,
            p256dh: device.p256dh as string,
            auth: device.auth as string,
          };
    return { delivery, target, message };
  }

  /**
   * A message about the person's own account. It carries no signal, so it does not depend on signal access: it
   * reaches someone whose subscription ended. A signed-out device or a disabled account still gets nothing.
   */
  private async prepareNotice(
    delivery: DeliveryRow,
    notice: NonNullable<DeliveryRow['notice']>,
    now: Date,
    badge?: number,
  ): Promise<PreparedPush | null> {
    const { id, pushSubscription: device } = delivery;
    const { user, session } = device;
    const sessionLive = session !== null && session.revokedAt === null && session.expiresAt > now;
    if (user.status !== 'ACTIVE' || !sessionLive || device.invalidatedAt) {
      await this.finish(id, 'SKIPPED', null, user.status !== 'ACTIVE' ? 'Account not active' : 'Device signed out');
      return null;
    }
    if (now.getTime() - notice.createdAt.getTime() > 24 * 3600 * 1000) {
      await this.finish(id, 'FAILED', null, 'Too old to be useful');
      return null;
    }
    const hide = user.preferences?.hidePreview ?? false;
    const message: PushMessage = {
      title: hide ? 'Account update' : notice.title,
      body: hide ? 'Open the app to read it.' : notice.body.slice(0, 1000),
      url: '/app',
      path: '/feed',
      tag: notice.id,
      urgent: false,
      androidChannel: 'announcements',
      interruptionLevel: 'active',
      badge,
      threadId: 'account',
      data: { tradeId: null, seq: 0, tradeVersion: null, category: 'ACCOUNT', priority: 'NORMAL', direction: null },
    };
    const target: PushTarget =
      device.channel === 'EXPO'
        ? { channel: 'EXPO', endpoint: device.endpoint }
        : {
            channel: 'WEB_PUSH',
            endpoint: device.endpoint,
            p256dh: device.p256dh as string,
            auth: device.auth as string,
          };
    return { delivery, target, message };
  }

  /** One statement for the whole batch, so recording results stays cheap at any number of phones. */
  private async recordAccepted(
    accepted: { delivery: DeliveryRow; result: Extract<PushResult, { kind: 'ACCEPTED' }> }[],
  ): Promise<void> {
    if (accepted.length === 0) return;
    const now = new Date();
    const rows = JSON.stringify(
      accepted.map(({ delivery, result }) => ({
        id: delivery.id,
        status_code: result.statusCode,
        receipt_id: result.receiptId ?? null,
      })),
    );
    await this.prisma.$transaction([
      this.prisma.$executeRaw`
        UPDATE push_deliveries AS d
        SET status = 'ACCEPTED', accepted_at = ${now}, last_status_code = r.status_code, last_error = NULL,
            locked_at = NULL, receipt_id = r.receipt_id, updated_at = ${now}
        FROM jsonb_to_recordset(${rows}::jsonb) AS r(id uuid, status_code int, receipt_id text)
        WHERE d.id = r.id`,
      this.prisma.pushSubscription.updateMany({
        where: { id: { in: accepted.map(({ delivery }) => delivery.pushSubscriptionId) } },
        data: { lastAcceptedAt: now },
      }),
    ]);
  }

  private async recordResult(delivery: DeliveryRow, result: PushResult): Promise<void> {
    const { id, pushSubscription: device } = delivery;
    const now = new Date();
    switch (result.kind) {
      case 'ACCEPTED':
        await this.recordAccepted([{ delivery, result }]);
        break;
      case 'GONE':
        await this.prisma.$transaction([
          this.prisma.pushDelivery.update({
            where: { id },
            data: { status: 'GONE', lastStatusCode: result.statusCode, lastError: result.error, lockedAt: null },
          }),
          this.prisma.pushSubscription.update({ where: { id: device.id }, data: { invalidatedAt: now } }),
        ]);
        break;
      case 'FAILED':
        await this.finish(id, 'FAILED', result.statusCode, result.error);
        break;
      case 'RETRY':
        if (delivery.attempts >= PUSH_MAX_ATTEMPTS) {
          await this.finish(
            id,
            'FAILED',
            result.statusCode,
            `Gave up after ${delivery.attempts} attempts: ${result.error}`,
          );
        } else {
          await this.prisma.pushDelivery.update({
            where: { id },
            data: {
              status: 'RETRY',
              nextAttemptAt: new Date(now.getTime() + retryDelayMs(delivery.attempts)),
              lastStatusCode: result.statusCode,
              lastError: result.error,
              lockedAt: null,
            },
          });
        }
        break;
    }
  }

  private async finish(
    id: string,
    status: 'SKIPPED' | 'FAILED',
    statusCode: number | null,
    error: string,
  ): Promise<void> {
    await this.prisma.pushDelivery.update({
      where: { id },
      data: { status, lastStatusCode: statusCode, lastError: error, lockedAt: null },
    });
  }

  /**
   * Expo first accepts a message, then later says whether Apple or Google took it. This is how a device
   * that uninstalled the app gets removed. Safe to repeat, and to run on several workers at once.
   */
  async checkExpoReceipts(): Promise<void> {
    if (!this.transport.nativeAvailable) return;
    const now = Date.now();
    const due = await this.prisma.pushDelivery.findMany({
      where: {
        receiptId: { not: null },
        receiptCheckedAt: null,
        acceptedAt: { lte: new Date(now - env.EXPO_RECEIPT_DELAY_SECONDS * 1000) },
      },
      orderBy: { acceptedAt: 'asc' },
      take: 300,
      select: { id: true, receiptId: true, acceptedAt: true, pushSubscriptionId: true },
    });
    if (due.length === 0) return;
    const receipts = await this.transport.fetchExpoReceipts(due.map((d) => d.receiptId as string));
    for (const delivery of due) {
      const receipt = receipts[delivery.receiptId as string];
      const checkedAt = new Date();
      if (!receipt) {
        // Expo keeps receipts for a day. After that nothing more can be learned.
        if (now - (delivery.acceptedAt as Date).getTime() > 86_400_000) {
          await this.prisma.pushDelivery.update({ where: { id: delivery.id }, data: { receiptCheckedAt: checkedAt } });
        }
        continue;
      }
      if (receipt.status === 'ok') {
        await this.prisma.pushDelivery.update({ where: { id: delivery.id }, data: { receiptCheckedAt: checkedAt } });
        continue;
      }
      const code = receipt.details?.error ?? 'Unknown';
      const gone = code === 'DeviceNotRegistered';
      await this.prisma.$transaction([
        this.prisma.pushDelivery.update({
          where: { id: delivery.id },
          data: { status: gone ? 'GONE' : 'FAILED', lastError: `Expo receipt: ${code}`, receiptCheckedAt: checkedAt },
        }),
        ...(gone
          ? [
              this.prisma.pushSubscription.update({
                where: { id: delivery.pushSubscriptionId },
                data: { invalidatedAt: checkedAt },
              }),
            ]
          : []),
      ]);
    }
  }

  /**
   * Housekeeping. Safe to run on every worker at once: expiring a signal is guarded by its version, so
   * a second attempt simply loses, and the deletions are naturally idempotent.
   */
  async sweep(): Promise<void> {
    await this.trades.expireDue();
    const now = Date.now();
    const days = (n: number) => new Date(now - n * 86_400_000);
    await this.prisma.rateLimitBucket.deleteMany({ where: { windowStart: { lt: days(1) } } });
    await this.prisma.workerHeartbeat.deleteMany({ where: { lastSeenAt: { lt: days(1) } } });
    await this.prisma.fanoutMetric.deleteMany({ where: { createdAt: { lt: days(30) } } });
    await this.prisma.pushDelivery.deleteMany({
      where: { createdAt: { lt: days(90) }, status: { in: ['ACCEPTED', 'GONE', 'SKIPPED', 'FAILED'] } },
    });
    await this.prisma.session.deleteMany({
      where: { expiresAt: { lt: days(90) }, pushSubscriptions: { none: {} } },
    });
    if (now - this.lastPurge > 10 * 60_000) {
      this.lastPurge = now;
      // Details typed at sign-up are not kept beyond a day if the address was never proved.
      await this.challenges.purgeStale();
      await this.prisma.emailOutbox.deleteMany({
        where: { createdAt: { lt: days(90) }, status: { in: ['SENT', 'DEAD'] }, enquiries: { none: {} } },
      });
    }
  }
}
