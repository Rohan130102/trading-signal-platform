import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  androidChannelFor,
  eventCategory,
  type EventType,
  evaluateSignalAccess,
  mobileDeepLinkPath,
} from '@signaldesk/domain';
import { log } from '../common/log.js';
import { env } from '../config/env.js';
import { CH_EVENTS, CH_PUSH, ListenerService } from '../db/listener.service.js';
import { Prisma, PrismaService } from '../db/prisma.service.js';
import { TradesService } from '../trades/trades.service.js';
import { PUSH_TTL_SECONDS, type PushMessage, type PushTarget, PushTransport } from './push-transport.js';

const OUTBOX_MAX_ATTEMPTS = 8;
const PUSH_MAX_ATTEMPTS = 6;
const PUSH_BATCH = 50;
const PUSH_CONCURRENCY = 20;

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly listener: ListenerService,
    private readonly transport: PushTransport,
    private readonly trades: TradesService,
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const startedAt = new Date();
    this.listener.on(CH_EVENTS, () => void this.runOutbox());
    this.listener.on(CH_PUSH, () => void this.runPush());
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
      setInterval(
        guarded('expo_receipts', () => this.checkExpoReceipts()),
        env.EXPO_RECEIPT_POLL_SECONDS * 1000,
      ),
      setInterval(
        guarded('sweep', () => this.sweep()),
        15_000,
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

  /** One row per eligible device. The unique key makes a repeat of this step harmless. */
  private async expandEvent(eventId: string): Promise<void> {
    const event = await this.prisma.signalEvent.findUniqueOrThrow({ where: { id: eventId }, select: { type: true } });
    if (!this.transport.available) return;
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
        AND (u.role = 'ADMIN' OR (sub.starts_at <= now() AND sub.expires_at > now()))
      ON CONFLICT (event_id, push_subscription_id) DO NOTHING`;
    if (inserted > 0) void this.runPush();
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
    const queue = claimed.map((c) => c.id);
    await Promise.all(
      Array.from({ length: Math.min(PUSH_CONCURRENCY, queue.length) }, async () => {
        for (let id = queue.shift(); id !== undefined; id = queue.shift()) await this.deliverSafely(id);
      }),
    );
    return claimed.length;
  }

  /** One failing row must not strand the rest of its batch until their claims expire. */
  private async deliverSafely(id: string): Promise<void> {
    try {
      await this.deliver(id);
    } catch (error) {
      const message = (error as Error).message.slice(0, 200);
      log('warn', 'push_delivery_failed', { id, error: message });
      await this.prisma.pushDelivery
        .update({
          where: { id },
          data: { status: 'RETRY', nextAttemptAt: new Date(Date.now() + 30_000), lastError: message, lockedAt: null },
        })
        .catch(() => undefined);
    }
  }

  private async deliver(id: string): Promise<void> {
    const delivery = await this.prisma.pushDelivery.findUniqueOrThrow({
      where: { id },
      include: {
        event: {
          select: { id: true, tradeId: true, title: true, body: true, type: true, priority: true, createdAt: true },
        },
        pushSubscription: {
          include: {
            session: true,
            user: { include: { subscription: true, preferences: true } },
          },
        },
      },
    });
    const { event, pushSubscription: device } = delivery;
    const { user, session } = device;
    const now = new Date();

    // Checked again immediately before sending: access may have ended since the job was queued.
    const access = evaluateSignalAccess(user, user.subscription, now);
    const sessionLive = session !== null && session.revokedAt === null && session.expiresAt > now;
    if (!access.allowed || !sessionLive || device.invalidatedAt) {
      await this.finish(id, 'SKIPPED', null, access.allowed ? 'Device signed out' : `Access ended: ${access.reason}`);
      return;
    }
    if (now.getTime() - event.createdAt.getTime() > PUSH_TTL_SECONDS * 1000) {
      await this.finish(id, 'FAILED', null, 'Too old to be useful');
      return;
    }

    const hide = user.preferences?.hidePreview ?? false;
    const message: PushMessage = {
      title: hide ? 'New update' : event.title,
      body: hide ? 'Open the app to read it.' : event.body.split('\n').slice(0, 4).join('\n').slice(0, 1000),
      url: event.tradeId ? `/app/trades/${event.tradeId}` : '/app',
      path: mobileDeepLinkPath(event.tradeId),
      tag: event.id,
      urgent: event.priority === 'PRIORITY' || event.type === 'SIGNAL_PUBLISHED',
      androidChannel: androidChannelFor(eventCategory(event.type as EventType), event.priority),
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
    const result = await this.transport.send(target, message);
    switch (result.kind) {
      case 'ACCEPTED':
        await this.prisma.$transaction([
          this.prisma.pushDelivery.update({
            where: { id },
            data: {
              status: 'ACCEPTED',
              acceptedAt: now,
              lastStatusCode: result.statusCode,
              lastError: null,
              lockedAt: null,
              receiptId: result.receiptId ?? null,
            },
          }),
          this.prisma.pushSubscription.update({ where: { id: device.id }, data: { lastAcceptedAt: now } }),
        ]);
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
  }
}
