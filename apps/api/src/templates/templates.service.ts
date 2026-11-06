import { Injectable } from '@nestjs/common';
import {
  DEFAULT_TEMPLATES,
  renderTemplateText,
  type TemplateContext,
  type TemplateKind,
  validateTemplateText,
} from '@signaldesk/domain';
import { AppError, notFound } from '../common/http.js';
import { PrismaService, type Tx } from '../db/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';

export interface ResolvedTemplate {
  id: string | null;
  kind: string;
  tone: string;
  title: string;
  body: string;
}

export interface TemplateInput {
  name: string;
  tone: string;
  title: string;
  body: string;
  active: boolean;
  favorite: boolean;
}

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.signalTemplate.findMany({ orderBy: [{ favorite: 'desc' }, { kind: 'asc' }, { name: 'asc' }] });
  }

  private validate(input: TemplateInput): void {
    const issues = [...validateTemplateText(input.title, 'title'), ...validateTemplateText(input.body, 'body')];
    if (issues.length > 0) throw new AppError(422, 'VALIDATION', issues[0]?.message ?? 'Invalid template', { issues });
  }

  async create(kind: TemplateKind, input: TemplateInput, actorId: string, requestId: string) {
    this.validate(input);
    const row = await this.prisma.signalTemplate.create({ data: { kind, ...input, isDefault: false } }).catch(() => {
      throw new AppError(409, 'TEMPLATE_EXISTS', 'A template with that name already exists for this type.');
    });
    await this.audit.record({
      actorId,
      action: 'TEMPLATE_CREATED',
      targetType: 'template',
      targetId: row.id,
      requestId,
    });
    return row;
  }

  async update(id: string, input: TemplateInput, actorId: string, requestId: string) {
    this.validate(input);
    const before = await this.prisma.signalTemplate.findUnique({ where: { id } });
    if (!before) throw notFound('Template not found');
    const row = await this.prisma.signalTemplate.update({ where: { id }, data: input }).catch(() => {
      throw new AppError(409, 'TEMPLATE_EXISTS', 'A template with that name already exists for this type.');
    });
    await this.audit.record({
      actorId,
      action: 'TEMPLATE_UPDATED',
      targetType: 'template',
      targetId: id,
      metadata: { before: { title: before.title, body: before.body }, after: { title: row.title, body: row.body } },
      requestId,
    });
    return row;
  }

  /** The administrator's default for a kind, or the built-in wording if it was switched off. */
  async resolve(kind: TemplateKind, tx: Tx): Promise<ResolvedTemplate> {
    const row = await tx.signalTemplate.findFirst({ where: { kind, isDefault: true, active: true } });
    if (row) return row;
    const fallback = DEFAULT_TEMPLATES.find((t) => t.kind === kind);
    if (!fallback) throw new Error(`No template for ${kind}`);
    return { id: null, kind, tone: fallback.tone, title: fallback.title, body: fallback.body };
  }

  render(template: ResolvedTemplate, ctx: TemplateContext): { title: string; body: string } {
    return { title: renderTemplateText(template.title, ctx), body: renderTemplateText(template.body, ctx) };
  }
}
