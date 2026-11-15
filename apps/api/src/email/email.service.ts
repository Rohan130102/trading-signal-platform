import { Injectable } from '@nestjs/common';
import { log } from '../common/log.js';
import { env } from '../config/env.js';
import { PrismaService, type Tx } from '../db/prisma.service.js';
import { type EmailMessage, EmailTransport, EmailUnavailableError } from './email-transport.js';

export const CH_EMAIL = 'email_ready';
const MAX_ATTEMPTS = 6;

export function emailRetryDelayMs(attempt: number): number {
  return Math.min(30 * 60_000, 15_000 * 2 ** Math.max(0, attempt - 1));
}

export interface QueuedEmail extends EmailMessage {
  kind: string;
  userId?: string | null;
  /** The same key never produces a second email, however often the request is repeated. */
  dedupeKey?: string;
}

/**
 * Durable outgoing email. A message is queued in the same transaction as the change it reports, so it can
 * neither be lost nor sent for a change that rolled back. The worker sends it and retries with backoff.
 */
@Injectable()
export class EmailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transport: EmailTransport,
  ) {}

  /** Whether anything can be sent now: the configuration screen's account, the server's, or files in development. */
  available(): Promise<boolean> {
    return this.transport.available();
  }

  async enqueue(tx: Tx, email: QueuedEmail): Promise<bigint | null> {
    const rows = await tx.$queryRaw<{ id: bigint }[]>`
      INSERT INTO email_outbox (kind, to_address, reply_to, subject, body_text, dedupe_key, user_id)
      VALUES (${email.kind}, ${email.to}, ${email.replyTo ?? null}, ${email.subject}, ${email.text},
              ${email.dedupeKey ?? null}, ${email.userId ?? null}::uuid)
      ON CONFLICT (dedupe_key) DO NOTHING
      RETURNING id`;
    if (rows[0]) await tx.$executeRaw`SELECT pg_notify(${CH_EMAIL}, '')`;
    if (rows[0]) return rows[0].id;
    if (!email.dedupeKey) return null;
    const existing = await tx.emailOutbox.findUnique({ where: { dedupeKey: email.dedupeKey }, select: { id: true } });
    return existing?.id ?? null;
  }

  /**
   * Sign-in codes go out at once and are never stored readable, so they cannot wait in the queue. One quick
   * retry covers a dropped connection; after that the person is told to try again.
   */
  async sendNow(message: EmailMessage): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.transport.send(message);
        return;
      } catch (error) {
        if (error instanceof EmailUnavailableError || attempt >= 2) throw error;
        log('warn', 'email_send_retry', { error: (error as Error).message.slice(0, 200) });
      }
    }
  }

  /** Claims due messages with SKIP LOCKED, so several workers never send the same one. */
  async processBatch(): Promise<number> {
    if (!(await this.transport.available())) return 0;
    const claimed = await this.prisma.$queryRaw<
      {
        id: bigint;
        to_address: string;
        reply_to: string | null;
        subject: string;
        body_text: string;
        attempts: number;
      }[]
    >`
      UPDATE email_outbox SET status = 'SENDING', locked_at = now(), attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM email_outbox
        WHERE (status = 'PENDING' AND next_attempt_at <= now())
           OR (status = 'SENDING' AND locked_at < now() - make_interval(secs => ${env.WORKER_LOCK_TIMEOUT_SECONDS}::double precision))
        ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 10
      )
      RETURNING id, to_address, reply_to, subject, body_text, attempts`;
    for (const row of claimed) {
      try {
        const accepted = await this.transport.send({
          to: row.to_address,
          replyTo: row.reply_to,
          subject: row.subject,
          text: row.body_text,
        });
        await this.prisma.emailOutbox.update({
          where: { id: row.id },
          data: {
            status: 'SENT',
            sentAt: new Date(),
            lockedAt: null,
            providerMessageId: accepted.messageId,
            lastError: null,
          },
        });
      } catch (error) {
        const message = (error as Error).message.slice(0, 500);
        const dead = row.attempts >= MAX_ATTEMPTS;
        log(dead ? 'error' : 'warn', dead ? 'email_dead_letter' : 'email_retry', {
          id: String(row.id),
          error: message,
        });
        await this.prisma.emailOutbox.update({
          where: { id: row.id },
          data: {
            status: dead ? 'DEAD' : 'PENDING',
            nextAttemptAt: new Date(Date.now() + emailRetryDelayMs(row.attempts)),
            lockedAt: null,
            lastError: message,
          },
        });
      }
    }
    return claimed.length;
  }
}
