import { Injectable } from '@nestjs/common';
import {
  type NotificationPreferences,
  type PushConfig,
  type PushDevice,
  pushSubscribeSchema,
  registerDeviceSchema,
} from '@signaldesk/domain';
import type { z } from 'zod';
import { AppError } from '../common/http.js';
import { CH_PUSH } from '../db/listener.service.js';
import { PrismaService } from '../db/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PushTransport } from './push-transport.js';

const WORKER_HEALTHY_SECONDS = 20;
/** Thresholds for the alerts on the health page and in the worker's log. */
export const BACKLOG_ALERT_SECONDS = 60;
export const FAILURE_RATE_ALERT = 0.05;

interface Percentiles {
  samples: bigint;
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

const round = (value: number | null | undefined) => (value === null || value === undefined ? null : Math.round(value));
const percentiles = (row: Percentiles | undefined) => ({
  samples: Number(row?.samples ?? 0),
  p50Ms: round(row?.p50),
  p95Ms: round(row?.p95),
  p99Ms: round(row?.p99),
});

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transport: PushTransport,
    private readonly audit: AuditService,
  ) {}

  config(): PushConfig {
    return {
      available: this.transport.webAvailable,
      publicKey: this.transport.publicKey,
      mode: this.transport.mode,
      nativeAvailable: this.transport.nativeAvailable,
    };
  }

  /** A token belongs to one installed app. Registering moves it, so a shared phone follows whoever signed in last. */
  async registerNativeDevice(userId: string, sessionId: string, input: z.infer<typeof registerDeviceSchema>) {
    if (!this.transport.nativeAvailable) {
      throw new AppError(503, 'NATIVE_PUSH_UNAVAILABLE', 'Notifications are not available on this service right now.');
    }
    const fields = {
      userId,
      sessionId,
      channel: 'EXPO' as const,
      platform: input.platform,
      deviceLabel: input.deviceLabel,
    };
    const row = await this.prisma.pushSubscription.upsert({
      where: { endpoint: input.token },
      create: { ...fields, endpoint: input.token },
      update: { ...fields, invalidatedAt: null },
    });
    return { id: row.id };
  }

  async unregisterNativeDevice(userId: string, token: string): Promise<void> {
    await this.unsubscribe(userId, token);
  }

  /** An endpoint belongs to one browser. Re-registering moves it, so a shared device stops getting the previous person's alerts. */
  async subscribe(userId: string, sessionId: string, input: z.infer<typeof pushSubscribeSchema>) {
    if (!this.transport.isAllowedEndpoint(input.endpoint)) {
      throw new AppError(422, 'PUSH_ENDPOINT_NOT_ALLOWED', 'This browser uses a push service we do not support.');
    }
    const row = await this.prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: {
        userId,
        sessionId,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        deviceLabel: input.deviceLabel,
      },
      update: {
        userId,
        sessionId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        deviceLabel: input.deviceLabel,
        invalidatedAt: null,
      },
    });
    return { id: row.id };
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.updateMany({
      where: { userId, endpoint },
      data: { invalidatedAt: new Date(), sessionId: null },
    });
  }

  async devices(userId: string, sessionId: string): Promise<PushDevice[]> {
    const rows = await this.prisma.pushSubscription.findMany({
      where: { userId, invalidatedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      deviceLabel: r.deviceLabel,
      channel: r.channel,
      platform: r.platform,
      createdAt: r.createdAt.toISOString(),
      lastAcceptedAt: r.lastAcceptedAt?.toISOString() ?? null,
      thisDevice: r.sessionId === sessionId,
    }));
  }

  /** Sends only to this user's own registered devices. The content is fixed and carries no signal data. */
  async sendTest(userId: string) {
    const devices = await this.prisma.pushSubscription.findMany({ where: { userId, invalidatedAt: null } });
    if (devices.length === 0) throw new AppError(422, 'NO_DEVICE', 'Turn on notifications on this device first.');
    const results = await Promise.all(
      devices.map((d) =>
        this.transport.send(
          d.channel === 'EXPO'
            ? { channel: 'EXPO', endpoint: d.endpoint }
            : { channel: 'WEB_PUSH', endpoint: d.endpoint, p256dh: d.p256dh as string, auth: d.auth as string },
          {
            title: 'Test notification',
            body: 'If you can read this, notifications reach this device.',
            url: '/app/account',
            path: '/account',
            tag: `test-${d.id}`,
            urgent: false,
            androidChannel: 'announcements',
          },
        ),
      ),
    );
    return {
      attempted: results.length,
      accepted: results.filter((r) => r.kind === 'ACCEPTED').length,
      note: 'Accepted means the push service took the message. Check that it actually appears on your device.',
    };
  }

  async getPreferences(userId: string): Promise<NotificationPreferences> {
    const row = await this.prisma.notificationPreference.findUnique({ where: { userId } });
    return {
      pushNewSignals: row?.pushNewSignals ?? true,
      pushUpdates: row?.pushUpdates ?? true,
      pushClosures: row?.pushClosures ?? true,
      pushAnnouncements: row?.pushAnnouncements ?? true,
      hidePreview: row?.hidePreview ?? false,
    };
  }

  async setPreferences(
    userId: string,
    input: {
      pushNewSignals: boolean;
      pushUpdates: boolean;
      pushClosures: boolean;
      pushAnnouncements: boolean;
      hidePreview: boolean;
    },
  ) {
    await this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...input },
      update: input,
    });
    return this.getPreferences(userId);
  }

  /**
   * Conditions that need a person to look. Shown on the health page, and logged by the worker so a log
   * alerting rule can page someone. Each is something measured, not inferred.
   */
  async alerts(now = new Date()): Promise<string[]> {
    const backlogCutoff = new Date(now.getTime() - BACKLOG_ALERT_SECONDS * 1000);
    const hourAgo = new Date(now.getTime() - 3_600_000);
    const [worker, stuckOutbox, dead, stuckPush, recent] = await Promise.all([
      this.prisma.workerHeartbeat.findFirst({ orderBy: { lastSeenAt: 'desc' }, select: { lastSeenAt: true } }),
      this.prisma.outboxEvent.count({
        where: { status: { in: ['PENDING', 'PROCESSING'] }, createdAt: { lt: backlogCutoff } },
      }),
      this.prisma.outboxEvent.count({ where: { status: 'DEAD' } }),
      this.prisma.pushDelivery.count({
        where: { status: { in: ['PENDING', 'SENDING', 'RETRY'] }, createdAt: { lt: backlogCutoff } },
      }),
      this.prisma.pushDelivery.groupBy({
        by: ['status'],
        where: { updatedAt: { gte: hourAgo }, status: { in: ['ACCEPTED', 'FAILED'] } },
        _count: { _all: true },
      }),
    ]);
    const alerts: string[] = [];
    const workerAge = worker ? (now.getTime() - worker.lastSeenAt.getTime()) / 1000 : null;
    if (workerAge === null || workerAge >= WORKER_HEALTHY_SECONDS) {
      alerts.push('The notification worker is not running, so no alerts are being sent.');
    }
    if (stuckOutbox > 0) alerts.push(`${stuckOutbox} events have waited over a minute to be queued for sending.`);
    if (dead > 0)
      alerts.push(`${dead} events failed to queue after every retry. Use "Retry failed" once the cause is fixed.`);
    if (stuckPush > 0)
      alerts.push(`${stuckPush} notifications have waited over a minute to be handed to the push service.`);
    const accepted = recent.find((g) => g.status === 'ACCEPTED')?._count._all ?? 0;
    const failed = recent.find((g) => g.status === 'FAILED')?._count._all ?? 0;
    if (failed >= 5 && failed / Math.max(1, accepted + failed) > FAILURE_RATE_ALERT) {
      alerts.push(`${failed} of ${accepted + failed} notifications failed in the last hour.`);
    }
    return alerts;
  }

  /**
   * Recorded when someone opens a notification on this device. This is the only delivery signal a phone
   * can give: arrival itself is not reported by Apple or Google.
   */
  async markOpened(userId: string, sessionId: string, eventId: string): Promise<{ recorded: boolean }> {
    const updated = await this.prisma.pushDelivery.updateMany({
      where: { eventId, userId, openedAt: null, pushSubscription: { sessionId } },
      data: { openedAt: new Date() },
    });
    const event = await this.prisma.signalEvent.findFirst({
      where: { id: eventId, broadcast: true },
      select: { id: true },
    });
    if (event) {
      await this.prisma.notificationRead.createMany({ data: [{ userId, eventId }], skipDuplicates: true });
    }
    return { recorded: updated.count > 0 };
  }

  async health() {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 86_400_000);
    const [workers, outboxPending, oldestPending, outboxDead, pushGroups, latency, recentFailures] = await Promise.all([
      this.prisma.workerHeartbeat.findMany({ orderBy: { lastSeenAt: 'desc' }, take: 5 }),
      this.prisma.outboxEvent.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } }),
      this.prisma.outboxEvent.findFirst({
        where: { status: { in: ['PENDING', 'PROCESSING'] } },
        orderBy: { id: 'asc' },
        select: { createdAt: true },
      }),
      this.prisma.outboxEvent.count({ where: { status: 'DEAD' } }),
      this.prisma.pushDelivery.groupBy({
        by: ['status'],
        where: { createdAt: { gte: dayAgo } },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<{ samples: bigint; p50: number | null; p95: number | null; max: number | null }[]>`
        SELECT count(*) AS samples,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95,
               max(latency_ms) AS max
        FROM fanout_metrics WHERE created_at >= ${dayAgo} AND recipients > 0`,
      this.prisma.pushDelivery.findMany({
        where: { status: 'FAILED' },
        orderBy: { updatedAt: 'desc' },
        take: 20,
        select: {
          id: true,
          attempts: true,
          lastStatusCode: true,
          lastError: true,
          updatedAt: true,
          eventId: true,
          event: { select: { title: true, tradeId: true } },
        },
      }),
    ]);
    const [queue, acceptance, opened, alerts] = await Promise.all([
      this.prisma.$queryRaw<Percentiles[]>`
        SELECT count(*) AS samples,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY ms) AS p50,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY ms) AS p95,
               percentile_cont(0.99) WITHIN GROUP (ORDER BY ms) AS p99
        FROM (SELECT EXTRACT(EPOCH FROM (o.processed_at - e.created_at)) * 1000 AS ms
              FROM outbox_events o JOIN signal_events e ON e.id = o.event_id
              WHERE o.processed_at IS NOT NULL AND e.created_at >= ${dayAgo}) s`,
      this.prisma.$queryRaw<Percentiles[]>`
        SELECT count(*) AS samples,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY ms) AS p50,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY ms) AS p95,
               percentile_cont(0.99) WITHIN GROUP (ORDER BY ms) AS p99
        FROM (SELECT EXTRACT(EPOCH FROM (d.accepted_at - e.created_at)) * 1000 AS ms
              FROM push_deliveries d JOIN signal_events e ON e.id = d.event_id
              WHERE d.accepted_at IS NOT NULL AND d.accepted_at >= ${dayAgo}) s`,
      this.prisma.$queryRaw<Percentiles[]>`
        SELECT count(*) AS samples,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY ms) AS p50,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY ms) AS p95,
               percentile_cont(0.99) WITHIN GROUP (ORDER BY ms) AS p99
        FROM (SELECT EXTRACT(EPOCH FROM (d.opened_at - e.created_at)) * 1000 AS ms
              FROM push_deliveries d JOIN signal_events e ON e.id = d.event_id
              WHERE d.opened_at IS NOT NULL AND d.opened_at >= ${dayAgo}) s`,
      this.alerts(now),
    ]);
    const lastWorker = workers[0];
    const workerAge = lastWorker ? (now.getTime() - lastWorker.lastSeenAt.getTime()) / 1000 : null;
    const counts = Object.fromEntries(pushGroups.map((g) => [g.status, g._count._all]));
    const stats = latency[0];
    const workerHealthy = workerAge !== null && workerAge < WORKER_HEALTHY_SECONDS;
    return {
      status: !workerHealthy || outboxDead > 0 || alerts.length > 0 ? 'ATTENTION' : 'HEALTHY',
      worker: {
        healthy: workerHealthy,
        lastSeenSecondsAgo: workerAge === null ? null : Math.round(workerAge),
        instances: workers.filter((w) => now.getTime() - w.lastSeenAt.getTime() < WORKER_HEALTHY_SECONDS * 1000).length,
      },
      outbox: {
        pending: outboxPending,
        dead: outboxDead,
        oldestPendingSeconds: oldestPending
          ? Math.round((now.getTime() - oldestPending.createdAt.getTime()) / 1000)
          : null,
      },
      push: {
        transport: this.transport.mode,
        nativeAvailable: this.transport.nativeAvailable,
        last24h: {
          accepted: counts.ACCEPTED ?? 0,
          pending: (counts.PENDING ?? 0) + (counts.SENDING ?? 0) + (counts.RETRY ?? 0),
          failed: counts.FAILED ?? 0,
          invalidated: counts.GONE ?? 0,
          skipped: counts.SKIPPED ?? 0,
        },
        note: 'Accepted means the push service took the message. Browsers do not report whether a person saw it.',
      },
      live: {
        last24h: {
          samples: Number(stats?.samples ?? 0),
          p50Ms: stats?.p50 === null || stats?.p50 === undefined ? null : Math.round(stats.p50),
          p95Ms: stats?.p95 === null || stats?.p95 === undefined ? null : Math.round(stats.p95),
          maxMs: stats?.max ?? null,
        },
        sloTargetP95Ms: 2000,
        note: 'Time from commit until the server wrote to connected sockets. Excludes the network to the device.',
      },
      timings: {
        queue: percentiles(queue[0]),
        providerAcceptance: percentiles(acceptance[0]),
        opened: { ...percentiles(opened[0]), opens: Number(opened[0]?.samples ?? 0) },
        note: 'Measured over the last 24 hours from stored timestamps. Acceptance by Apple or Google is not arrival on the phone, which they do not report; an open is the only confirmed receipt.',
      },
      alerts,
      recentFailures: recentFailures.map((f) => ({
        id: f.id,
        attempts: f.attempts,
        statusCode: f.lastStatusCode,
        error: f.lastError,
        at: f.updatedAt.toISOString(),
        eventId: f.eventId,
        title: f.event.title,
        tradeId: f.event.tradeId,
      })),
    };
  }

  /** Requeues failures still recent enough to matter. Older ones stay failed and visible. */
  async retryFailed(actorId: string, requestId: string) {
    const cutoff = new Date(Date.now() - 3_600_000);
    const [deliveries, outbox] = await this.prisma.$transaction(async (tx) => {
      const pushed = await tx.pushDelivery.updateMany({
        where: { status: 'FAILED', event: { createdAt: { gte: cutoff } } },
        data: { status: 'RETRY', nextAttemptAt: new Date(), attempts: 0, lastError: null },
      });
      const requeued = await tx.outboxEvent.updateMany({
        where: { status: 'DEAD' },
        data: { status: 'PENDING', availableAt: new Date(), attempts: 0 },
      });
      await tx.$executeRaw`SELECT pg_notify(${CH_PUSH}, '')`;
      await this.audit.record(
        {
          actorId,
          action: 'NOTIFICATIONS_RETRIED',
          metadata: { deliveries: pushed.count, outbox: requeued.count },
          requestId,
        },
        tx,
      );
      return [pushed.count, requeued.count];
    });
    return { deliveries, outbox };
  }
}
