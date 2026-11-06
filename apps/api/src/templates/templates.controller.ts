import { Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import {
  DEFAULT_TEMPLATES,
  TEMPLATE_FIELDS,
  type TemplateKind,
  templateKindSchema,
  templateUpdateSchema,
} from '@signaldesk/domain';
import { z } from 'zod';
import { AdminOnly, Auth, type AuthContext, RequestId, Summary, ZBody } from '../common/http.js';
import { TemplatesService } from './templates.service.js';

const createSchema = templateUpdateSchema.extend({ kind: templateKindSchema });

@Controller('admin/templates')
@AdminOnly()
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  @Summary('List templates and the fields they may use')
  async list() {
    return {
      templates: await this.templates.list(),
      fields: TEMPLATE_FIELDS,
      kinds: DEFAULT_TEMPLATES.map((t) => ({ kind: t.kind, name: t.name })),
    };
  }

  @Post()
  @Summary('Create an additional template')
  create(
    @Auth() auth: AuthContext,
    @RequestId() requestId: string,
    @ZBody(createSchema) { kind, ...body }: z.infer<typeof createSchema>,
  ) {
    return this.templates.create(kind as TemplateKind, body, auth.user.id, requestId);
  }

  @Put(':id')
  @Summary('Edit a template. Published messages keep the wording they were sent with.')
  update(
    @Auth() auth: AuthContext,
    @RequestId() requestId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(templateUpdateSchema) body: z.infer<typeof templateUpdateSchema>,
  ) {
    return this.templates.update(id, body, auth.user.id, requestId);
  }
}
