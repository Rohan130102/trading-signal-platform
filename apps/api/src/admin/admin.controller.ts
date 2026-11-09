import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import {
  approvalSchema,
  auditQuery,
  LIVE_STATUSES,
  performanceQuery,
  settingsSchema,
  type TradeStatus,
} from '@signaldesk/domain';
import type { z } from 'zod';
import {
  AdminOnly,
  AppError,
  Auth,
  type AuthContext,
  MasterOnly,
  notFound,
  RequestId,
  Summary,
  ZBody,
  ZQuery,
} from '../common/http.js';
import { env } from '../config/env.js';
import { PrismaService } from '../db/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PerformanceService } from '../performance/performance.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { TradesQueries } from '../trades/trades.queries.js';
import { TradesService } from '../trades/trades.service.js';

@Controller('admin')
@AdminOnly()
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queries: TradesQueries,
    private readonly trades: TradesService,
    private readonly notifications: NotificationsService,
    private readonly performance: PerformanceService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  @Get('dashboard')
  @Summary('Everything the administrator needs at a glance')
  async dashboard() {
    const now = new Date();
    const soon = new Date(now.getTime() + 7 * 86_400_000);
    const [live, closed, recentEvents, drafts, total, active, expiring, expired, health] = await Promise.all([
      this.queries.adminList({ page: 1, pageSize: 50, live: true, status: undefined }),
      this.queries.adminList({ page: 1, pageSize: 8, status: 'CLOSED' as TradeStatus }),
      this.prisma.signalEvent.findMany({
        where: { broadcast: true },
        orderBy: { seq: 'desc' },
        take: 8,
        include: { trade: { select: { status: true } } },
      }),
      this.trades.listDrafts(),
      this.prisma.user.count({ where: { role: 'SUBSCRIBER' } }),
      this.prisma.user.count({
        where: {
          role: 'SUBSCRIBER',
          status: 'ACTIVE',
          subscription: { startsAt: { lte: now }, expiresAt: { gt: now } },
        },
      }),
      this.prisma.user.findMany({
        where: { role: 'SUBSCRIBER', status: 'ACTIVE', subscription: { expiresAt: { gt: now, lte: soon } } },
        select: { id: true, name: true, loginId: true, subscription: { select: { expiresAt: true } } },
        orderBy: { subscription: { expiresAt: 'asc' } },
        take: 10,
      }),
      this.prisma.user.count({ where: { role: 'SUBSCRIBER', subscription: { expiresAt: { lte: now } } } }),
      this.notifications.health(),
    ]);
    const dispatch = await this.queries.dispatchSummaries(recentEvents.map((e) => e.id));
    const alerts: { level: 'WARNING' | 'CRITICAL'; message: string; href: string }[] = [];
    if (!health.worker.healthy) {
      alerts.push({
        level: 'CRITICAL',
        message:
          'The notification worker is not running. In-app delivery still works, but push notifications are stalled.',
        href: '/admin/notifications',
      });
    }
    if (health.outbox.dead > 0) {
      alerts.push({
        level: 'CRITICAL',
        message: `${health.outbox.dead} notification job(s) failed permanently.`,
        href: '/admin/notifications',
      });
    }
    if (health.push.transport === 'disabled' && !health.push.nativeAvailable) {
      alerts.push({
        level: 'WARNING',
        message: 'Push notifications are not configured. Subscribers get in-app updates only.',
        href: '/admin/notifications',
      });
    }
    if (health.push.last24h.failed > 0) {
      alerts.push({
        level: 'WARNING',
        message: `${health.push.last24h.failed} push notification(s) failed in the last 24 hours.`,
        href: '/admin/notifications',
      });
    }
    const liveStatuses = new Set<string>(LIVE_STATUSES);
    return {
      active: live.trades.filter((t) => t.status !== 'PUBLISHED' && liveStatuses.has(t.status)),
      awaitingEntry: live.trades.filter((t) => t.status === 'PUBLISHED'),
      recentlyClosed: closed.trades,
      recentEvents: recentEvents.map((e) => ({
        seq: Number(e.seq),
        id: e.id,
        tradeId: e.tradeId,
        title: e.title,
        type: e.type,
        tone: e.tone,
        createdAt: e.createdAt.toISOString(),
        dispatch: dispatch.get(e.id) ?? null,
      })),
      drafts: drafts.length,
      subscribers: { total, active, expired, expiringSoon: expiring.length },
      expiring: expiring.map((u) => ({
        id: u.id,
        name: u.name,
        loginId: u.loginId,
        expiresAt: u.subscription?.expiresAt.toISOString() ?? null,
      })),
      health: { status: health.status, worker: health.worker, outbox: health.outbox, push: health.push },
      alerts,
    };
  }

  @Get('performance')
  @Summary('Internal analytics. Never exposed publicly.')
  performanceReport(@ZQuery(performanceQuery) query: z.infer<typeof performanceQuery>) {
    return this.performance.internal(query);
  }

  @Get('audit')
  @Summary('Audit log')
  async auditLog(@ZQuery(auditQuery) query: z.infer<typeof auditQuery>) {
    const where = {
      ...(query.action ? { action: { contains: query.action, mode: 'insensitive' as const } } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.targetId ? { targetId: query.targetId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { actor: { select: { name: true, loginId: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      entries: rows.map((r) => ({
        id: Number(r.id),
        action: r.action,
        actorName: r.actor?.name ?? 'System',
        targetType: r.targetType,
        targetId: r.targetId,
        metadata: r.metadata,
        requestId: r.requestId,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  @Get('integrity')
  @Summary('Verify the tamper-evident hash chain over all signal events')
  async integrity() {
    const [result] = await this.prisma.$queryRaw<{ checked: bigint; first_bad_seq: bigint | null }[]>`
      SELECT * FROM verify_signal_event_chain()`;
    return {
      checked: Number(result?.checked ?? 0),
      intact: result?.first_bad_seq === null || result?.first_bad_seq === undefined,
      firstBadSeq: result?.first_bad_seq ? Number(result.first_bad_seq) : null,
    };
  }

  @Get('settings')
  @Summary('Application settings')
  getSettings() {
    return this.settings.get();
  }

  @Put('settings')
  @MasterOnly()
  @Summary('Update settings and platform rules. Master Admin only.')
  updateSettings(
    @Auth() auth: AuthContext,
    @RequestId() requestId: string,
    @ZBody(settingsSchema) body: z.infer<typeof settingsSchema>,
  ) {
    return this.settings.update(body, auth.user.id, requestId);
  }

  @Get('compliance/public-performance')
  @Summary('State of the public performance gate and its approval records')
  async gate() {
    const gate = await this.performance.publicGate();
    const approvals = await this.prisma.publicPerformanceApproval.findMany({
      orderBy: { createdAt: 'desc' },
      include: { createdBy: { select: { name: true } } },
    });
    return {
      flagEnabled: gate.flagEnabled,
      enabled: gate.enabled,
      currentApprovalId: gate.approval?.id ?? null,
      approvals: approvals.map((a) => ({
        id: a.id,
        jurisdiction: a.jurisdiction,
        scope: a.scope,
        reviewerName: a.reviewerName,
        documentReference: a.documentReference,
        effectiveFrom: a.effectiveFrom.toISOString(),
        expiresAt: a.expiresAt.toISOString(),
        revokedAt: a.revokedAt?.toISOString() ?? null,
        notes: a.notes,
        createdBy: a.createdBy.name,
        createdAt: a.createdAt.toISOString(),
      })),
      deploymentFlag: 'PUBLIC_PERFORMANCE_ENABLED',
      flagValue: env.PUBLIC_PERFORMANCE_ENABLED,
    };
  }

  @Post('compliance/public-performance/approvals')
  @MasterOnly()
  @Summary('Record a documented compliance sign-off. Master Admin only.')
  async addApproval(
    @Auth() auth: AuthContext,
    @RequestId() requestId: string,
    @ZBody(approvalSchema) body: z.infer<typeof approvalSchema>,
  ) {
    const effectiveFrom = new Date(body.effectiveFrom);
    const expiresAt = new Date(body.expiresAt);
    if (expiresAt.getTime() <= effectiveFrom.getTime()) {
      throw new AppError(422, 'VALIDATION', 'The approval must end after it starts.');
    }
    const row = await this.prisma.publicPerformanceApproval.create({
      data: { ...body, effectiveFrom, expiresAt, createdById: auth.user.id },
    });
    await this.audit.record({
      actorId: auth.user.id,
      action: 'PUBLIC_PERFORMANCE_APPROVAL_RECORDED',
      targetType: 'approval',
      targetId: row.id,
      metadata: { jurisdiction: body.jurisdiction, documentReference: body.documentReference },
      requestId,
    });
    return { id: row.id };
  }

  @Post('compliance/public-performance/approvals/:id/revoke')
  @MasterOnly()
  @HttpCode(200)
  @Summary('Revoke an approval. The public section closes straight away.')
  async revokeApproval(
    @Auth() auth: AuthContext,
    @RequestId() requestId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const updated = await this.prisma.publicPerformanceApproval.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (updated.count !== 1) throw notFound('Approval not found');
    await this.audit.record({
      actorId: auth.user.id,
      action: 'PUBLIC_PERFORMANCE_APPROVAL_REVOKED',
      targetType: 'approval',
      targetId: id,
      requestId,
    });
    return { ok: true };
  }
}
