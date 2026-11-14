import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';

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

/**
 * The one place email leaves the system. Credentials come from the environment only. The file transport
 * exists for development and tests; the environment check refuses it in production.
 */
@Injectable()
export class EmailTransport {
  private smtp: Transporter | null = null;

  get available(): boolean {
    return env.EMAIL_TRANSPORT !== 'disabled';
  }

  get mode(): string {
    return env.EMAIL_TRANSPORT;
  }

  async send(message: EmailMessage): Promise<EmailAccepted> {
    switch (env.EMAIL_TRANSPORT) {
      case 'disabled':
        throw new EmailUnavailableError();
      case 'file':
        return this.writeFile(message);
      case 'smtp':
        return this.sendSmtp(message);
    }
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

  private async sendSmtp(message: EmailMessage): Promise<EmailAccepted> {
    this.smtp ??= nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      requireTLS: !env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    const info = await this.smtp.sendMail({
      from: env.EMAIL_FROM,
      to: message.to,
      replyTo: message.replyTo ?? undefined,
      subject: message.subject,
      text: message.text,
    });
    return { messageId: String(info.messageId ?? '') };
  }
}
