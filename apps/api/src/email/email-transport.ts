import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import type { EmailStatus } from '@signaldesk/domain';
import nodemailer, { type Transporter } from 'nodemailer';
import { decryptSecret } from '../common/crypto.js';
import { env } from '../config/env.js';
import { PrismaService } from '../db/prisma.service.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  replyTo?: string | null;
}

/** "Sent" here means the provider accepted the message. Whether it reached an inbox is not observable. */
export interface EmailAccepted {
  messageId: string;
}

export class EmailUnavailableError extends Error {
  constructor() {
    super('Email is not configured on this server');
    this.name = 'EmailUnavailableError';
  }
}

export interface SmtpAccount {
  host: string;
  port: number;
  /** True: TLS from the first byte (465). False: STARTTLS, which is then required. */
  secure: boolean;
  user: string;
  pass: string | undefined;
  from: string;
}

type Route =
  { kind: 'file' } | { kind: 'smtp'; account: SmtpAccount; source: 'SETTINGS' | 'SERVER' } | { kind: 'none' };

/** "Desk <desk@example.com>", or the bare address when there is no name. */
export function fromHeader(name: string, address: string): string {
  const clean = name.replace(/["<>\r\n]/g, '').trim();
  return clean ? `"${clean}" <${address}>` : address;
}

/**
 * The one place email leaves the system. Where it goes, in order:
 * 1. The file transport, when the server is set to it: development and tests only, refused in production.
 * 2. The account the Super Admin entered on the configuration screen, when switched on.
 * 3. The server's own SMTP settings from the environment.
 * Otherwise nothing can be sent, and sign-up says so before asking for anything.
 */
@Injectable()
export class EmailTransport {
  private smtp: { key: string; transporter: Transporter } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Read on every send, so a change on the configuration screen applies to the next email. */
  private async route(): Promise<Route> {
    if (env.EMAIL_TRANSPORT === 'file') return { kind: 'file' };
    const s = await this.prisma.appSettings.findUnique({
      where: { id: 1 },
      select: {
        emailEnabled: true,
        smtpHost: true,
        smtpPort: true,
        smtpSecurity: true,
        smtpUsername: true,
        smtpPasswordEnc: true,
        emailFromName: true,
        emailFromAddress: true,
      },
    });
    if (s?.emailEnabled) {
      return { kind: 'smtp', source: 'SETTINGS', account: settingsAccount(s) };
    }
    if (env.EMAIL_TRANSPORT === 'smtp') {
      return {
        kind: 'smtp',
        source: 'SERVER',
        account: {
          host: env.SMTP_HOST as string,
          port: env.SMTP_PORT,
          secure: env.SMTP_SECURE,
          user: env.SMTP_USER ?? '',
          pass: env.SMTP_PASS,
          from: env.EMAIL_FROM as string,
        },
      };
    }
    return { kind: 'none' };
  }

  async status(): Promise<EmailStatus> {
    const route = await this.route();
    if (route.kind === 'none') return 'NOT_SET_UP';
    return route.kind === 'smtp' && route.source === 'SETTINGS' ? 'READY' : 'SERVER';
  }

  async available(): Promise<boolean> {
    return (await this.status()) !== 'NOT_SET_UP';
  }

  async send(message: EmailMessage): Promise<EmailAccepted> {
    const route = await this.route();
    if (route.kind === 'none') throw new EmailUnavailableError();
    if (route.kind === 'file') return this.writeFile(message);
    return this.sendSmtp(route.account, message);
  }

  /** Sends with exactly these details, whatever else is configured. Used by the configuration screen's test. */
  sendWith(account: SmtpAccount, message: EmailMessage): Promise<EmailAccepted> {
    return this.sendSmtp(account, message);
  }

  private writeFile(message: EmailMessage): EmailAccepted {
    const dir = env.EMAIL_FILE_DIR as string;
    mkdirSync(dir, { recursive: true });
    const messageId = `${Date.now()}-${randomBytes(6).toString('hex')}`;
    writeFileSync(
      join(dir, `${messageId}.json`),
      JSON.stringify({ messageId, from: env.EMAIL_FROM ?? null, ...message }, null, 2),
      { mode: 0o600 },
    );
    return { messageId };
  }

  private transporter(account: SmtpAccount): Transporter {
    // A new connection pool only when the details change. The key is a hash, so the password is not kept twice.
    const key = createHash('sha256').update(JSON.stringify(account)).digest('hex');
    if (this.smtp?.key !== key) {
      this.smtp?.transporter.close();
      this.smtp = {
        key,
        transporter: nodemailer.createTransport({
          host: account.host,
          port: account.port,
          secure: account.secure,
          requireTLS: !account.secure,
          auth: account.user ? { user: account.user, pass: account.pass } : undefined,
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 20_000,
        }),
      };
    }
    return this.smtp.transporter;
  }

  private async sendSmtp(account: SmtpAccount, message: EmailMessage): Promise<EmailAccepted> {
    const info = await this.transporter(account).sendMail({
      from: account.from,
      to: message.to,
      replyTo: message.replyTo ?? undefined,
      subject: message.subject,
      text: message.text,
    });
    return { messageId: String(info.messageId ?? '') };
  }
}

export function settingsAccount(s: {
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: string;
  smtpUsername: string;
  smtpPasswordEnc: string | null;
  emailFromName: string;
  emailFromAddress: string;
}): SmtpAccount {
  return {
    host: s.smtpHost,
    port: s.smtpPort,
    secure: s.smtpSecurity === 'TLS',
    user: s.smtpUsername,
    pass: s.smtpPasswordEnc ? decryptSecret(s.smtpPasswordEnc) : undefined,
    from: fromHeader(s.emailFromName, s.emailFromAddress),
  };
}
