import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import {
  adminAnnouncementsQuery,
  announcementActionSchema,
  announcementBulkSchema,
  announcementCreateSchema,
  announcementPurgeSchema,
  announcementScheduleSchema,
  announcementSchema,
  announcementsQuery,
  announcementTemplateSchema,
  announcementUpdateSchema,
} from '@signaldesk/domain';
import { z } from 'zod';
import {
  AdminOnly,
  Auth,
  type AuthContext,
  RequestId,
  RequireSignalAccess,
  Summary,
  ZBody,
  ZQuery,
} from '../common/http.js';
import { PrismaService } from '../db/prisma.service.js';
import { TemplatesService } from '../templates/templates.service.js';
import { AnnouncementsService } from './announcements.service.js';

const createBody = z.union([announcementCreateSchema, announcementSchema]);
type Action = z.infer<typeof announcementActionSchema>;

@Controller()
export class AnnouncementsController {
  constructor(
    private readonly announcements: AnnouncementsService,
    private readonly templates: TemplatesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('announcements')
  @RequireSignalAccess()
  @Summary('Current announcements, pinned first. Expired, archived and hidden ones are left out.')
  board(@Auth() auth: AuthContext, @ZQuery(announcementsQuery) query: z.infer<typeof announcementsQuery>) {
    return this.announcements.visible(auth.user.id, query.page, query.pageSize);
  }

  @Get('admin/announcements')
  @AdminOnly()
  @Summary('Announcements in every state, with counts per state')
  list(@ZQuery(adminAnnouncementsQuery) query: z.infer<typeof adminAnnouncementsQuery>) {
    return this.announcements.list(query.view, query.q);
  }

  @Get('admin/announcements/:id')
  @AdminOnly()
  @Summary('One announcement and the actions possible from its state')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.announcements.get(id);
  }

  @Post('admin/announcements')
  @AdminOnly()
  @Summary('Save a draft, publish now or schedule. Repeating a request with the same key changes nothing.')
  async create(
    @Auth() auth: AuthContext,
    @RequestId() requestId: string,
    @ZBody(createBody) body: z.infer<typeof createBody>,
  ) {
    const actor = { id: auth.user.id, requestId };
    if ('message' in body) {
      // The original one-field form: rendered through the market update template, published at once.
      const rendered = await this.prisma.$transaction(async (tx) => {
        const template = await this.templates.resolve('MARKET_UPDATE', tx);
        return this.templates.render(template, { message: body.message });
      });
      return this.announcements.create(
        announcementCreateSchema.parse({
          title: body.title || rendered.title,
          body: body.message,
          category: body.priority === 'PRIORITY' ? 'IMPORTANT' : 'GENERAL',
          priority: body.priority,
          mode: 'PUBLISH',
          idempotencyKey: body.idempotencyKey,
        }),
        actor,
      );
    }
    return this.announcements.create(body, actor);
  }

  @Put('admin/announcements/:id')
  @AdminOnly()
  @Summary('Edit. After sending, this changes the Announcements tab only: the alert already sent is not changed.')
  update(
    @Auth() auth: AuthContext,
    @RequestId() requestId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(announcementUpdateSchema) body: z.infer<typeof announcementUpdateSchema>,
  ) {
    return this.announcements.update(id, body, { id: auth.user.id, requestId });
  }

  @Post('admin/announcements/:id/publish')
  @AdminOnly()
  @HttpCode(200)
  @Summary('Publish a draft or scheduled announcement now')
  publish(
    @Auth() a: AuthContext,
    @RequestId() r: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(announcementActionSchema) b: Action,
  ) {
    return this.announcements.publish(id, b.expectedVersion, { id: a.user.id, requestId: r });
  }

  @Post('admin/announcements/:id/schedule')
  @AdminOnly()
  @HttpCode(200)
  @Summary('Publish automatically at a future time')
  schedule(
    @Auth() a: AuthContext,
    @RequestId() r: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(announcementScheduleSchema) b: z.infer<typeof announcementScheduleSchema>,
  ) {
    return this.announcements.schedule(id, b.publishAt, b.expectedVersion, { id: a.user.id, requestId: r });
  }

  @Post('admin/announcements/:id/unschedule')
  @AdminOnly()
  @HttpCode(200)
  @Summary('Cancel a schedule and keep it as a draft')
  unschedule(
    @Auth() a: AuthContext,
    @RequestId() r: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(announcementActionSchema) b: Action,
  ) {
    return this.announcements.unschedule(id, b.expectedVersion, { id: a.user.id, requestId: r });
  }

  @Post('admin/announcements/:id/archive')
  @AdminOnly()
  @HttpCode(200)
  @Summary('Take a published announcement off the board. It stays in the record.')
  archive(
    @Auth() a: AuthContext,
    @RequestId() r: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(announcementActionSchema) b: Action,
  ) {
    return this.announcements.archive(id, b.expectedVersion, { id: a.user.id, requestId: r });
  }

  @Post('admin/announcements/:id/restore')
  @AdminOnly()
  @HttpCode(200)
  @Summary('Bring back from the archive or the bin')
  restore(
    @Auth() a: AuthContext,
    @RequestId() r: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(announcementActionSchema) b: Action,
  ) {
    return this.announcements.restore(id, b.expectedVersion, { id: a.user.id, requestId: r });
  }

  @Delete('admin/announcements/:id')
  @AdminOnly()
  @HttpCode(200)
  @Summary('Move to the bin. Restorable.')
  remove(
    @Auth() a: AuthContext,
    @RequestId() r: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(announcementActionSchema) b: Action,
  ) {
    return this.announcements.remove(id, b.expectedVersion, { id: a.user.id, requestId: r });
  }

  @Post('admin/announcements/:id/purge')
  @AdminOnly()
  @HttpCode(200)
  @Summary('Delete permanently. Only for announcements that were never sent.')
  purge(
    @Auth() a: AuthContext,
    @RequestId() r: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(announcementPurgeSchema) b: z.infer<typeof announcementPurgeSchema>,
  ) {
    return this.announcements.purge(id, b.expectedVersion, { id: a.user.id, requestId: r });
  }

  @Post('admin/announcements/bulk')
  @AdminOnly()
  @HttpCode(200)
  @Summary('Archive, restore or bin several at once. All or nothing.')
  bulk(
    @Auth() a: AuthContext,
    @RequestId() r: string,
    @ZBody(announcementBulkSchema) b: z.infer<typeof announcementBulkSchema>,
  ) {
    return this.announcements.bulk(b.ids, b.action, b.expectedCount, { id: a.user.id, requestId: r });
  }

  @Get('admin/announcement-templates')
  @AdminOnly()
  @Summary('Reusable announcement templates')
  async templateList() {
    return { templates: await this.announcements.templates(true) };
  }

  @Post('admin/announcement-templates')
  @AdminOnly()
  @Summary('Add a template')
  createTemplate(
    @Auth() a: AuthContext,
    @RequestId() r: string,
    @ZBody(announcementTemplateSchema) b: z.infer<typeof announcementTemplateSchema>,
  ) {
    return this.announcements.saveTemplate(null, b, { id: a.user.id, requestId: r });
  }

  @Put('admin/announcement-templates/:id')
  @AdminOnly()
  @Summary('Edit or retire a template')
  updateTemplate(
    @Auth() a: AuthContext,
    @RequestId() r: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(announcementTemplateSchema) b: z.infer<typeof announcementTemplateSchema>,
  ) {
    return this.announcements.saveTemplate(id, b, { id: a.user.id, requestId: r });
  }
}
