import { Injectable } from '@nestjs/common';
import type { SettingsInput } from '@signaldesk/domain';
import { isValidTimezone } from '@signaldesk/domain';
import { AppError } from '../common/http.js';
import { PrismaService } from '../db/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  get() {
    return this.prisma.appSettings.findUniqueOrThrow({ where: { id: 1 } });
  }

  async timezone(): Promise<string> {
    return (await this.get()).businessTimezone;
  }

  async update(input: SettingsInput, actorId: string, requestId: string) {
    if (!isValidTimezone(input.businessTimezone)) {
      throw new AppError(422, 'VALIDATION', `Unknown timezone: ${input.businessTimezone}`);
    }
    const before = await this.get();
    const after = await this.prisma.appSettings.update({ where: { id: 1 }, data: input });
    const changed = Object.keys(input).filter(
      (k) => before[k as keyof typeof before] !== after[k as keyof typeof after],
    );
    await this.audit.record({
      actorId,
      action: 'SETTINGS_UPDATED',
      targetType: 'settings',
      targetId: '1',
      metadata: { changed },
      requestId,
    });
    return after;
  }
}
