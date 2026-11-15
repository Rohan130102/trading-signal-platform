import { Injectable } from '@nestjs/common';
import type {
  AdminSettings,
  EmailSecurity,
  EmailSettingsInput,
  EmailSettingsView,
  HistoryScope,
  PlatformSettings,
  SettingsInput,
  SignalStartMode,
  SupportContact,
  TrailingStopWording,
} from '@signaldesk/domain';
import { ADMIN_SETTINGS_FIELDS, isValidTimezone, maskEmail } from '@signaldesk/domain';
import { encryptSecret } from '../common/crypto.js';
import { AppError } from '../common/http.js';
import { log } from '../common/log.js';
import { notifyRefresh } from '../db/listener.service.js';
import { PrismaService } from '../db/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { EmailTransport, settingsAccount } from '../email/email-transport.js';

type SettingsRow = Awaited<ReturnType<PrismaService['appSettings']['findUniqueOrThrow']>>;

/** The SMTP fields whose change makes an earlier successful test meaningless. */
const EMAIL_DETAIL_FIELDS = [
  'smtpHost',
  'smtpPort',
  'smtpSecurity',
  'smtpUsername',
  'emailFromName',
  'emailFromAddress',
] as const;

/** What went wrong with a test email, in words the Super Admin can act on. Never includes the password. */
function testFailure(error: unknown, host: string, port: number): string {
  const e = error as { code?: string; message?: string; responseCode?: number };
  switch (e.code) {
    case 'EAUTH':
      return 'The email server refused the username or password. For Gmail, use an app password, not your normal password.';
    case 'EDNS':
    case 'ENOTFOUND':
      return `${host} was not found. Check the server name.`;
    case 'ECONNECTION':
    case 'ESOCKET':
    case 'ETIMEDOUT':
    case 'ECONNREFUSED':
      return `Could not connect to ${host} on port ${port}. Check the server, the port and the security setting.`;
    case 'ETLS':
      return 'The secure connection failed. Try the other security setting, or check the port.';
    case 'EENVELOPE':
      return 'The email server refused the sender or the recipient address. Check the "From" address.';
    default:
      return `The email could not be sent: ${(e.message ?? 'unknown error').slice(0, 200)}`;
  }
}

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
  'signupOpen',
  'defaultTrialDays',
] as const;

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly email: EmailTransport,
  ) {}

  /** The whole row, secrets included. For use inside the server only: screens get `view()`. */
  get() {
    return this.prisma.appSettings.findUniqueOrThrow({ where: { id: 1 } });
  }

  /** Every platform setting and nothing secret: the email account has its own Super Admin endpoint. */
  async view(row?: SettingsRow): Promise<AdminSettings> {
    const s = row ?? (await this.get());
    const fields = Object.fromEntries(ADMIN_SETTINGS_FIELDS.map((k) => [k, s[k]]));
    return {
      ...(fields as Omit<AdminSettings, 'id' | 'updatedAt' | 'dataResetAt'>),
      id: s.id,
      updatedAt: s.updatedAt.toISOString(),
      dataResetAt: s.dataResetAt?.toISOString() ?? null,
    };
  }

  /** The email account as the configuration screen shows it. Whether a password is saved, never the password. */
  async emailView(row?: SettingsRow): Promise<EmailSettingsView> {
    const s = row ?? (await this.get());
    return {
      enabled: s.emailEnabled,
      host: s.smtpHost,
      port: s.smtpPort,
      security: s.smtpSecurity as EmailSecurity,
      username: s.smtpUsername,
      passwordSet: s.smtpPasswordEnc !== null,
      fromName: s.emailFromName,
      fromAddress: s.emailFromAddress,
      testedAt: s.emailTestedAt?.toISOString() ?? null,
      status: await this.email.status(),
    };
  }

  /** Master Admin only. The password is encrypted at once and kept only in that form; the log names what changed. */
  async updateEmail(input: EmailSettingsInput, actorId: string, requestId: string): Promise<EmailSettingsView> {
    const before = await this.get();
    const password = input.password?.trim() ? input.password : undefined;
    if (input.enabled && input.username && !password && before.smtpPasswordEnc === null) {
      throw new AppError(422, 'VALIDATION', 'Enter the password for this email account.', {
        issues: [{ field: 'password', message: 'Enter the password for this email account' }],
      });
    }
    const data = {
      emailEnabled: input.enabled,
      smtpHost: input.host,
      smtpPort: input.port,
      smtpSecurity: input.security,
      smtpUsername: input.username,
      emailFromName: input.fromName,
      emailFromAddress: input.fromAddress,
      ...(password ? { smtpPasswordEnc: encryptSecret(password) } : {}),
    };
    const detailsChanged = Boolean(password) || EMAIL_DETAIL_FIELDS.some((k) => before[k] !== data[k]);
    const after = await this.prisma.appSettings.update({
      where: { id: 1 },
      data: { ...data, ...(detailsChanged ? { emailTestedAt: null } : {}) },
    });
    await this.audit.record({
      actorId,
      action: 'EMAIL_SETTINGS_UPDATED',
      targetType: 'settings',
      targetId: '1',
      metadata: {
        enabled: { from: before.emailEnabled, to: after.emailEnabled },
        host: { from: before.smtpHost, to: after.smtpHost },
        port: { from: before.smtpPort, to: after.smtpPort },
        security: { from: before.smtpSecurity, to: after.smtpSecurity },
        fromAddress: { from: before.emailFromAddress, to: after.emailFromAddress },
        usernameChanged: before.smtpUsername !== after.smtpUsername,
        passwordChanged: Boolean(password),
      },
      requestId,
    });
    return this.emailView(after);
  }

  /** Sends one email with the saved details, whether or not they are switched on yet. */
  async testEmail(to: string, actorId: string, requestId: string): Promise<{ ok: true }> {
    const s = await this.get();
    if (!s.smtpHost || !s.emailFromAddress) {
      throw new AppError(422, 'EMAIL_NOT_SAVED', 'Save the server and the "From" address first, then send a test.');
    }
    try {
      await this.email.sendWith(settingsAccount(s), {
        to,
        subject: `${s.serviceName}: test email`,
        text: [
          'This is a test from the configuration screen.',
          '',
          'If you can read this, sign-up codes and account emails will arrive from this address.',
        ].join('\n'),
      });
    } catch (error) {
      const message = testFailure(error, s.smtpHost, s.smtpPort);
      log('warn', 'email_test_failed', { code: (error as { code?: string }).code ?? null });
      await this.audit.record({
        actorId,
        action: 'EMAIL_TEST_FAILED',
        targetType: 'settings',
        targetId: '1',
        metadata: { to: maskEmail(to), reason: message },
        requestId,
      });
      throw new AppError(422, 'EMAIL_TEST_FAILED', message);
    }
    await this.prisma.appSettings.update({ where: { id: 1 }, data: { emailTestedAt: new Date() } });
    await this.audit.record({
      actorId,
      action: 'EMAIL_TEST_SENT',
      targetType: 'settings',
      targetId: '1',
      metadata: { to: maskEmail(to) },
      requestId,
    });
    return { ok: true };
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
    return this.view(after);
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
    return this.view(after);
  }
}
