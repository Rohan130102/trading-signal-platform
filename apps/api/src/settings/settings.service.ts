import { Injectable } from '@nestjs/common';
import type {
  HistoryScope,
  PlatformSettings,
  SettingsInput,
  SignalStartMode,
  SupportContact,
  TrailingStopWording,
} from '@signaldesk/domain';
import { isValidTimezone } from '@signaldesk/domain';
import { AppError } from '../common/http.js';
import { notifyRefresh } from '../db/listener.service.js';
import { PrismaService } from '../db/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';

/** Business rules whose before and after values go into the audit log. Free text is only named. */
const RULE_FIELDS = [
  'signalStartMode',
  'entryExpiryMinutesDefault',
  'trailingStopWording',
  'screenshotsAllowedDefault',
  'historyScope',
  'businessTimezone',
  'supportWhatsapp',
  'supportEmail',
] as const;

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

  /** The rules the API applies, typed. The database constrains every value to these sets. */
  async platform(): Promise<PlatformSettings> {
    const s = await this.get();
    return {
      signalStartMode: s.signalStartMode as SignalStartMode,
      entryExpiryMinutesDefault: s.entryExpiryMinutesDefault,
      trailingStopWording: s.trailingStopWording as TrailingStopWording,
      screenshotsAllowedDefault: s.screenshotsAllowedDefault,
      historyScope: s.historyScope as HistoryScope,
    };
  }

  /** Read on every request, so a change applies to every screen and email at once. */
  async support(): Promise<SupportContact> {
    const s = await this.get();
    return {
      serviceName: s.serviceName,
      whatsapp: s.supportWhatsapp,
      email: s.supportEmail,
      contact: s.supportContact,
      renewalInstructions: s.renewalInstructions,
    };
  }

  /** Master Admin only. Before and after go into the audit log: these decide where enquiries are sent. */
  async updateSupport(input: { supportWhatsapp: string; supportEmail: string }, actorId: string, requestId: string) {
    const before = await this.get();
    const after = await this.prisma.appSettings.update({ where: { id: 1 }, data: input });
    await this.audit.record({
      actorId,
      action: 'SUPPORT_CONTACT_UPDATED',
      targetType: 'settings',
      targetId: '1',
      metadata: {
        whatsapp: { from: before.supportWhatsapp, to: after.supportWhatsapp },
        email: { from: before.supportEmail, to: after.supportEmail },
      },
      requestId,
    });
    await notifyRefresh(this.prisma, 'SETTINGS_CHANGED');
    return after;
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
    const rules = Object.fromEntries(
      RULE_FIELDS.filter((k) => changed.includes(k)).map((k) => [k, { from: before[k], to: after[k] }]),
    );
    await this.audit.record({
      actorId,
      action: 'SETTINGS_UPDATED',
      targetType: 'settings',
      targetId: '1',
      metadata: { changed, rules },
      requestId,
    });
    // Apps reload the signed-in person's rules, such as screenshot permission, without a restart.
    if (Object.keys(rules).length > 0) await notifyRefresh(this.prisma, 'SETTINGS_CHANGED');
    return after;
  }
}
