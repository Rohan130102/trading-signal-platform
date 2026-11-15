import { Injectable } from '@nestjs/common';
import {
  type AdminAnnouncement,
  type AdminAnnouncementsPage,
  type AdminAnnouncementView,
  allowedAnnouncementActions,
  type AnnouncementAction,
  type AnnouncementCategory,
  type AnnouncementCreateInput,
  announcementPriority,
  type AnnouncementsPage,
  type AnnouncementState,
  type AnnouncementStatus,
  type AnnouncementTemplate,
  type AnnouncementTemplateInput,
  type AnnouncementUpdateInput,
  type AnnouncementView,
  canTakeAnnouncementAction,
  type Priority,
} from '@signaldesk/domain';
import { AppError, notFound } from '../common/http.js';
import { isUniqueViolation, Prisma, PrismaService, type Tx, TX_OPTIONS } from '../db/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AudienceService } from '../feed/audience.service.js';
import { EventStore } from '../trades/event-store.js';

type Row = Prisma.AnnouncementRecordGetPayload<{ include: { createdBy: { select: { name: true } } } }>;

export interface Actor {
  id: string;
  requestId: string;
}

const TONE: Record<AnnouncementCategory, string> = {
  GENERAL: 'NEUTRAL',
  IMPORTANT: 'UPDATE',
  MARKET_UPDATE: 'UPDATE',
  MAINTENANCE: 'NEUTRAL',
  EDUCATIONAL: 'NEUTRAL',
  URGENT: 'STOP',
};

/** A schedule in the past is refused, with a minute's grace for a slow form submission. */
const SCHEDULE_GRACE_MS = 60_000;

function stateOf(row: Pick<Row, 'status' | 'deletedAt' | 'eventId'>): AnnouncementState {
  return {
    status: row.status as AnnouncementStatus,
    deleted: row.deletedAt !== null,
    everPublished: row.eventId !== null,
  };
}

function toView(row: Row): AnnouncementView {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    category: row.category as AnnouncementCategory,
    priority: row.priority,
    pinned: row.pinned,
    linkUrl: row.linkUrl,
    linkLabel: row.linkLabel,
    publishedAt: (row.publishedAt ?? row.createdAt).toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}

function toAdmin(row: Row): AdminAnnouncement {
  const state = stateOf(row);
  return {
    ...toView(row),
    status: state.status,
    deleted: state.deleted,
    everPublished: state.everPublished,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    publishAt: row.publishAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdByName: row.createdBy?.name ?? null,
    version: row.version,
    allowedActions: allowedAnnouncementActions(state),
  };
}

const WITH_AUTHOR = { createdBy: { select: { name: true } } } as const;

function viewWhere(view: AdminAnnouncementView): Prisma.AnnouncementRecordWhereInput {
  switch (view) {
    case 'ALL':
      return { deletedAt: null };
    case 'LIVE':
      return { deletedAt: null, status: 'PUBLISHED' };
    case 'SCHEDULED':
      return { deletedAt: null, status: 'SCHEDULED' };
    case 'DRAFT':
      return { deletedAt: null, status: 'DRAFT' };
    case 'ARCHIVED':
      return { deletedAt: null, status: 'ARCHIVED' };
    case 'BIN':
      return { deletedAt: { not: null } };
  }
}

/**
 * Draft, preview, publish now or on a schedule, edit, archive, bin and restore. Publishing appends one
 * ANNOUNCEMENT event in the same transaction as the status change, so a sent announcement always has its
 * notification job, and the event's idempotency key makes a second send impossible.
 */
@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventStore,
    private readonly audit: AuditService,
    private readonly audience: AudienceService,
  ) {}

  /* ---------- Subscribers ---------- */

  /** The board, by the same rule as trades: what was published while this person was entitled, and service notices. */
  async visible(userId: string, page: number, pageSize: number): Promise<AnnouncementsPage> {
    const [hidden, periods] = await Promise.all([
      this.prisma.userHiddenItem.findMany({ where: { userId, itemType: 'ANNOUNCEMENT' }, select: { itemId: true } }),
      this.audience.periods(userId),
    ]);
    const now = new Date();
    const where: Prisma.AnnouncementRecordWhereInput = {
      status: 'PUBLISHED',
      deletedAt: null,
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, this.audience.announcementWhere(periods)],
      ...(hidden.length > 0 ? { id: { notIn: hidden.map((h) => h.itemId) } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.announcementRecord.findMany({
        where,
        orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: WITH_AUTHOR,
      }),
      this.prisma.announcementRecord.count({ where }),
    ]);
    return { announcements: rows.map(toView), total, page, pageSize };
  }

  /* ---------- Administrators ---------- */

  async list(view: AdminAnnouncementView, q?: string): Promise<AdminAnnouncementsPage> {
    const search: Prisma.AnnouncementRecordWhereInput = q
      ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { body: { contains: q, mode: 'insensitive' } }] }
      : {};
    const [rows, groups, binned] = await Promise.all([
      this.prisma.announcementRecord.findMany({
        where: { ...viewWhere(view), ...search },
        orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
        take: 200,
        include: WITH_AUTHOR,
      }),
      this.prisma.announcementRecord.groupBy({ by: ['status'], where: { deletedAt: null }, _count: { _all: true } }),
      this.prisma.announcementRecord.count({ where: { deletedAt: { not: null } } }),
    ]);
    const count = (status: string) => groups.find((g) => g.status === status)?._count._all ?? 0;
    return {
      announcements: rows.map(toAdmin),
      counts: {
        LIVE: count('PUBLISHED'),
        SCHEDULED: count('SCHEDULED'),
        DRAFT: count('DRAFT'),
        ARCHIVED: count('ARCHIVED'),
        BIN: binned,
      },
    };
  }

  async get(id: string): Promise<AdminAnnouncement> {
    const row = await this.prisma.announcementRecord.findUnique({ where: { id }, include: WITH_AUTHOR });
    if (!row) throw notFound('Announcement not found');
    return toAdmin(row);
  }

  async create(
    input: AnnouncementCreateInput,
    actor: Actor,
  ): Promise<AdminAnnouncement & { eventId: string | null; replayed: boolean }> {
    const existing = await this.prisma.announcementRecord.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: WITH_AUTHOR,
    });
    if (existing) return { ...toAdmin(existing), eventId: existing.eventId, replayed: true };
    if (input.mode === 'SCHEDULE') this.assertFuture(input.publishAt as string);
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const row = await tx.announcementRecord.create({
          data: {
            title: input.title,
            body: input.body,
            category: input.category,
            priority: announcementPriority(input.category, input.priority),
            pinned: input.pinned,
            linkUrl: input.linkUrl,
            linkLabel: input.linkUrl ? input.linkLabel : null,
            status: input.mode === 'SCHEDULE' ? 'SCHEDULED' : 'DRAFT',
            publishAt: input.mode === 'SCHEDULE' ? new Date(input.publishAt as string) : null,
            expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
            idempotencyKey: input.idempotencyKey,
            createdById: actor.id,
            updatedById: actor.id,
          },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            action: input.mode === 'SCHEDULE' ? 'ANNOUNCEMENT_SCHEDULED' : 'ANNOUNCEMENT_DRAFTED',
            targetType: 'announcement',
            targetId: row.id,
            metadata: { category: row.category, publishAt: row.publishAt?.toISOString() ?? null },
            requestId: actor.requestId,
          },
          tx,
        );
        if (input.mode === 'PUBLISH') await this.publishInTx(tx, row.id, actor);
        return row.id;
      }, TX_OPTIONS);
      const created = await this.get(id);
      const row = await this.prisma.announcementRecord.findUniqueOrThrow({ where: { id }, select: { eventId: true } });
      return { ...created, eventId: row.eventId, replayed: false };
    } catch (error) {
      if (isUniqueViolation(error, 'idempotency_key')) {
        const again = await this.prisma.announcementRecord.findUniqueOrThrow({
          where: { idempotencyKey: input.idempotencyKey },
          include: WITH_AUTHOR,
        });
        return { ...toAdmin(again), eventId: again.eventId, replayed: true };
      }
      throw error;
    }
  }

  async update(id: string, input: AnnouncementUpdateInput, actor: Actor): Promise<AdminAnnouncement> {
    await this.prisma.$transaction(async (tx) => {
      const row = await this.lockFor(tx, id, 'EDIT', input.expectedVersion);
      const scheduled = row.status === 'SCHEDULED';
      if (scheduled) this.assertFuture(input.publishAt ?? row.publishAt?.toISOString() ?? '');
      const published = row.status === 'PUBLISHED';
      await tx.announcementRecord.update({
        where: { id },
        data: {
          title: input.title,
          body: input.body,
          category: input.category,
          priority: announcementPriority(input.category, input.priority),
          pinned: input.pinned,
          linkUrl: input.linkUrl,
          linkLabel: input.linkUrl ? input.linkLabel : null,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          ...(scheduled && input.publishAt ? { publishAt: new Date(input.publishAt) } : {}),
          ...(published ? { editedAt: new Date() } : {}),
          version: { increment: 1 },
          updatedById: actor.id,
          updatedAt: new Date(),
        },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'ANNOUNCEMENT_EDITED',
          targetType: 'announcement',
          targetId: id,
          metadata: {
            before: { title: row.title, body: row.body, category: row.category, pinned: row.pinned },
            after: { title: input.title, body: input.body, category: input.category, pinned: input.pinned },
            // An edit after sending changes what the Announcements tab shows. The sent alert is unchanged.
            afterSending: published,
          },
          requestId: actor.requestId,
        },
        tx,
      );
    }, TX_OPTIONS);
    return this.get(id);
  }

  async publish(id: string, expectedVersion: number, actor: Actor): Promise<AdminAnnouncement> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockFor(tx, id, 'PUBLISH', expectedVersion);
      await this.publishInTx(tx, id, actor);
    }, TX_OPTIONS);
    return this.get(id);
  }

  async schedule(id: string, publishAt: string, expectedVersion: number, actor: Actor): Promise<AdminAnnouncement> {
    this.assertFuture(publishAt);
    await this.transition(id, 'SCHEDULE', expectedVersion, actor, 'ANNOUNCEMENT_SCHEDULED', {
      status: 'SCHEDULED',
      publishAt: new Date(publishAt),
    });
    return this.get(id);
  }

  async unschedule(id: string, expectedVersion: number, actor: Actor) {
    await this.transition(id, 'UNSCHEDULE', expectedVersion, actor, 'ANNOUNCEMENT_UNSCHEDULED', {
      status: 'DRAFT',
      publishAt: null,
    });
    return this.get(id);
  }

  async archive(id: string, expectedVersion: number, actor: Actor) {
    await this.transition(id, 'ARCHIVE', expectedVersion, actor, 'ANNOUNCEMENT_ARCHIVED', {
      status: 'ARCHIVED',
      archivedAt: new Date(),
      pinned: false,
    });
    return this.get(id);
  }

  /** Out of the bin it goes back to where it was; out of the archive it goes back on the board. */
  async restore(id: string, expectedVersion: number, actor: Actor) {
    const row = await this.prisma.announcementRecord.findUnique({ where: { id } });
    if (!row) throw notFound('Announcement not found');
    const data: Prisma.AnnouncementRecordUpdateInput =
      row.deletedAt !== null ? { deletedAt: null } : { status: 'PUBLISHED', archivedAt: null };
    await this.transition(id, 'RESTORE', expectedVersion, actor, 'ANNOUNCEMENT_RESTORED', data);
    return this.get(id);
  }

  /** Into the bin. Restorable, and a sent announcement keeps its event either way. */
  async remove(id: string, expectedVersion: number, actor: Actor) {
    await this.transition(id, 'DELETE', expectedVersion, actor, 'ANNOUNCEMENT_DELETED', {
      deletedAt: new Date(),
      pinned: false,
    });
    return this.get(id);
  }

  /** Permanent, and only for something never sent. Anything sent is part of the record and stays. */
  async purge(id: string, expectedVersion: number, actor: Actor): Promise<{ purged: true }> {
    await this.prisma.$transaction(async (tx) => {
      const row = await this.lockFor(tx, id, 'PURGE', expectedVersion);
      await tx.userHiddenItem.deleteMany({ where: { itemType: 'ANNOUNCEMENT', itemId: id } });
      await tx.announcementRecord.delete({ where: { id } });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'ANNOUNCEMENT_PURGED',
          targetType: 'announcement',
          targetId: id,
          metadata: { title: row.title, status: row.status },
          requestId: actor.requestId,
        },
        tx,
      );
    }, TX_OPTIONS);
    return { purged: true };
  }

  /**
   * Several at once, all or nothing. The count the administrator confirmed must match what is eligible
   * now, so nothing changes if the selection moved underneath them.
   */
  async bulk(ids: string[], action: 'ARCHIVE' | 'RESTORE' | 'DELETE', expectedCount: number, actor: Actor) {
    const unique = [...new Set(ids)];
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string; status: string; deleted_at: Date | null; event_id: string | null }[]
      >`
        SELECT id, status, deleted_at, event_id FROM announcements WHERE id = ANY(${unique}::uuid[]) FOR UPDATE`;
      const eligible = rows.filter((r) =>
        canTakeAnnouncementAction(
          {
            status: r.status as AnnouncementStatus,
            deleted: r.deleted_at !== null,
            everPublished: r.event_id !== null,
          },
          action,
        ),
      );
      if (eligible.length !== expectedCount || eligible.length !== unique.length) {
        throw new AppError(
          409,
          'SELECTION_CHANGED',
          `${eligible.length} of the ${unique.length} selected can be changed this way. Review the selection and try again.`,
          { eligible: eligible.map((r) => r.id) },
        );
      }
      const now = new Date();
      for (const row of eligible) {
        const data: Prisma.AnnouncementRecordUpdateInput =
          action === 'ARCHIVE'
            ? { status: 'ARCHIVED', archivedAt: now, pinned: false }
            : action === 'DELETE'
              ? { deletedAt: now, pinned: false }
              : row.deleted_at !== null
                ? { deletedAt: null }
                : { status: 'PUBLISHED', archivedAt: null };
        await tx.announcementRecord.update({
          where: { id: row.id },
          data: { ...data, version: { increment: 1 }, updatedBy: { connect: { id: actor.id } }, updatedAt: now },
        });
      }
      await this.audit.record(
        {
          actorId: actor.id,
          action: `ANNOUNCEMENTS_BULK_${action}`,
          targetType: 'announcement',
          metadata: { ids: eligible.map((r) => r.id), count: eligible.length },
          requestId: actor.requestId,
        },
        tx,
      );
      return { changed: eligible.length };
    }, TX_OPTIONS);
  }

  /**
   * Called by the worker. Each due announcement is claimed with SKIP LOCKED and published in its own
   * transaction, so several workers never send one twice and one failure does not hold up the rest.
   */
  async publishDue(now = new Date(), limit = 20): Promise<number> {
    let published = 0;
    for (let i = 0; i < limit; i += 1) {
      const done = await this.prisma.$transaction(async (tx) => {
        const due = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM announcements
          WHERE status = 'SCHEDULED' AND deleted_at IS NULL AND publish_at <= ${now}
          ORDER BY publish_at FOR UPDATE SKIP LOCKED LIMIT 1`;
        const id = due[0]?.id;
        if (!id) return false;
        await this.publishInTx(tx, id, null);
        return true;
      }, TX_OPTIONS);
      if (!done) break;
      published += 1;
    }
    return published;
  }

  /* ---------- Templates ---------- */

  async templates(includeInactive: boolean): Promise<AnnouncementTemplate[]> {
    const rows = await this.prisma.announcementTemplate.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category as AnnouncementCategory,
      title: r.title,
      body: r.body,
      active: r.active,
      sortOrder: r.sortOrder,
    }));
  }

  async saveTemplate(id: string | null, input: AnnouncementTemplateInput, actor: Actor) {
    try {
      const row = id
        ? await this.prisma.announcementTemplate.update({ where: { id }, data: { ...input, updatedAt: new Date() } })
        : await this.prisma.announcementTemplate.create({ data: input });
      await this.audit.record({
        actorId: actor.id,
        action: id ? 'ANNOUNCEMENT_TEMPLATE_UPDATED' : 'ANNOUNCEMENT_TEMPLATE_CREATED',
        targetType: 'announcement_template',
        targetId: row.id,
        metadata: { name: row.name },
        requestId: actor.requestId,
      });
      return { id: row.id };
    } catch (error) {
      if (isUniqueViolation(error))
        throw new AppError(409, 'TEMPLATE_EXISTS', 'A template with that name already exists.');
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025')
        throw notFound('Template not found');
      throw error;
    }
  }

  /* ---------- Internals ---------- */

  private assertFuture(iso: string): void {
    const at = new Date(iso).getTime();
    if (!Number.isFinite(at) || at < Date.now() - SCHEDULE_GRACE_MS) {
      throw new AppError(422, 'SCHEDULE_IN_PAST', 'Choose a time in the future.');
    }
  }

  private async lockFor(tx: Tx, id: string, action: AnnouncementAction, expectedVersion: number): Promise<Row> {
    await tx.$queryRaw`SELECT id FROM announcements WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await tx.announcementRecord.findUnique({ where: { id }, include: WITH_AUTHOR });
    if (!row) throw notFound('Announcement not found');
    if (row.version !== expectedVersion) {
      throw new AppError(409, 'STALE', 'Someone changed this announcement since you opened it. Reload and try again.');
    }
    if (!canTakeAnnouncementAction(stateOf(row), action)) {
      throw new AppError(409, 'NOT_ALLOWED', 'That is not possible for this announcement in its current state.');
    }
    return row;
  }

  private async transition(
    id: string,
    action: AnnouncementAction,
    expectedVersion: number,
    actor: Actor,
    auditAction: string,
    data: Prisma.AnnouncementRecordUpdateInput,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockFor(tx, id, action, expectedVersion);
      await tx.announcementRecord.update({
        where: { id },
        data: { ...data, version: { increment: 1 }, updatedBy: { connect: { id: actor.id } }, updatedAt: new Date() },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: auditAction,
          targetType: 'announcement',
          targetId: id,
          requestId: actor.requestId,
        },
        tx,
      );
    }, TX_OPTIONS);
  }

  /** Inside the caller's transaction, with the row already locked or just created. */
  private async publishInTx(tx: Tx, id: string, actor: Actor | null): Promise<void> {
    const row = await tx.announcementRecord.findUniqueOrThrow({ where: { id } });
    if (row.eventId) return;
    const category = row.category as AnnouncementCategory;
    const priority: Priority = announcementPriority(category, row.priority);
    const event = await this.events.append(tx, {
      tradeId: null,
      tradeVersion: null,
      type: 'ANNOUNCEMENT',
      broadcast: true,
      priority,
      tone: TONE[category],
      title: row.title,
      body: row.body,
      templateId: null,
      actorId: actor?.id ?? row.createdById,
      idempotencyKey: `announcement:${row.id}`,
      payload: { title: row.title, message: row.body, priority, announcementId: row.id, category },
    });
    const now = new Date();
    await tx.announcementRecord.update({
      where: { id },
      data: {
        status: 'PUBLISHED',
        publishedAt: now,
        eventId: event.id,
        priority,
        version: { increment: 1 },
        updatedAt: now,
        ...(actor ? { updatedById: actor.id } : {}),
      },
    });
    await this.audit.record(
      {
        actorId: actor?.id ?? null,
        action: 'ANNOUNCEMENT_PUBLISHED',
        targetType: 'announcement',
        targetId: id,
        metadata: { eventId: event.id, scheduled: actor === null, category },
        requestId: actor?.requestId,
      },
      tx,
    );
  }
}
