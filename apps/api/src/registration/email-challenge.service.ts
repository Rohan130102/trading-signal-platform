import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  type ChallengeResponse,
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_SECONDS,
  OTP_TTL_SECONDS,
  SETUP_TOKEN_TTL_SECONDS,
} from '@signaldesk/domain';
import { RateLimitService } from '../auth/rate-limit.service.js';
import { AppError } from '../common/http.js';
import { log } from '../common/log.js';
import { env } from '../config/env.js';
import { Prisma, PrismaService } from '../db/prisma.service.js';
import { EmailService } from '../email/email.service.js';
import { EmailUnavailableError, type EmailMessage } from '../email/email-transport.js';

export type ChallengePurpose = 'REGISTRATION' | 'PASSWORD_RESET';

const HOUR = 3600;
/** Codes one address may be sent per hour, across every challenge. */
const SENDS_PER_EMAIL = 5;
/** New challenges one client may start per hour, and code checks it may make across every challenge. */
const STARTS_PER_IP = () => env.EMAIL_CODE_IP_LIMIT_PER_HOUR;
const CHECKS_PER_IP = () => env.EMAIL_CODE_IP_LIMIT_PER_HOUR * 3;

const THROTTLED = new AppError(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts. Wait a while and try again.');
const INVALID_CODE = (left: number) =>
  new AppError(
    422,
    'INVALID_CODE',
    left > 0 ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'That code is not right.',
  );
const NOT_CONFIGURED = new AppError(
  503,
  'EMAIL_NOT_CONFIGURED',
  'Email is not set up on this server yet, so a code cannot be sent. Contact support.',
);
const SEND_FAILED = new AppError(503, 'EMAIL_SEND_FAILED', 'We could not send the email. Try again in a minute.');

function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Keyed, so a copy of the table does not let anyone try codes offline. Bound to the challenge. */
function codeHash(challengeId: string, code: string): string {
  return createHmac('sha256', Buffer.from(env.APP_ENCRYPTION_KEY, 'base64'))
    .update(`email-code:${challengeId}:${code}`)
    .digest('hex');
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

function newCode(): string {
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
}

type Row = Prisma.EmailChallengeGetPayload<object>;

export interface IssueInput {
  purpose: ChallengePurpose;
  email: string;
  ip: string;
  /** The account this concerns, when there is one. */
  userId: string | null;
  details?: Prisma.InputJsonValue;
  /**
   * What to email. A code is only sent where proving the address leads somewhere; otherwise a different message,
   * or none, so the answer never reveals whether an account exists.
   */
  message: ((code: string) => EmailMessage) | { fixed: EmailMessage } | null;
}

/**
 * Proof that someone controls an email address: a 6-digit code, valid for 5 minutes, at most 5 tries per code,
 * a new code at most once a minute, each new code replacing the last. Only a keyed hash is stored, a code works
 * once, and every step is limited per address and per client.
 */
@Injectable()
export class EmailChallengeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limits: RateLimitService,
    private readonly email: EmailService,
  ) {}

  private respond(row: Row): ChallengeResponse {
    const sentAt = row.sentAt ?? row.createdAt;
    return {
      challengeId: row.id,
      email: row.email,
      resendAvailableAt: new Date(sentAt.getTime() + OTP_RESEND_SECONDS * 1000).toISOString(),
      expiresAt: new Date(sentAt.getTime() + OTP_TTL_SECONDS * 1000).toISOString(),
    };
  }

  async issue(input: IssueInput): Promise<ChallengeResponse> {
    if (!this.email.available) throw NOT_CONFIGURED;
    const ipKey = `challenge:ip:${fingerprint(input.ip)}`;
    if ((await this.limits.count(ipKey, HOUR)) >= STARTS_PER_IP()) throw THROTTLED;
    await this.limits.hit(ipKey, HOUR);

    // A repeat of the same request within the resend window gets the same challenge and no second email.
    const recent = await this.prisma.emailChallenge.findFirst({
      where: {
        purpose: input.purpose,
        email: input.email,
        verifiedAt: null,
        consumedAt: null,
        sentAt: { gt: new Date(Date.now() - OTP_RESEND_SECONDS * 1000) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (recent) {
      if (input.details !== undefined && input.userId === null) {
        await this.prisma.emailChallenge.update({ where: { id: recent.id }, data: { details: input.details } });
      }
      return this.respond(recent);
    }

    const row = await this.prisma.emailChallenge.create({
      data: {
        id: randomUUID(),
        purpose: input.purpose,
        email: input.email,
        userId: input.userId,
        details: input.details ?? Prisma.JsonNull,
      },
    });
    return this.send(row, input.message);
  }

  async resend(challengeId: string, purpose: ChallengePurpose, ip: string, message: IssueInput['message']) {
    const ipKey = `challenge:ip:${fingerprint(ip)}`;
    if ((await this.limits.count(ipKey, HOUR)) >= STARTS_PER_IP()) throw THROTTLED;
    await this.limits.hit(ipKey, HOUR);
    const row = await this.prisma.emailChallenge.findFirst({ where: { id: challengeId, purpose } });
    if (!row || row.verifiedAt || row.consumedAt) {
      throw new AppError(409, 'CHALLENGE_CLOSED', 'This verification is finished. Start again.');
    }
    if (row.sentAt && row.sentAt.getTime() + OTP_RESEND_SECONDS * 1000 > Date.now()) {
      throw new AppError(
        429,
        'RESEND_TOO_SOON',
        `You can ask for a new code ${Math.ceil((row.sentAt.getTime() + OTP_RESEND_SECONDS * 1000 - Date.now()) / 1000)} seconds from now.`,
      );
    }
    return this.send(row, message);
  }

  private async send(row: Row, message: IssueInput['message']): Promise<ChallengeResponse> {
    const emailKey = `challenge:email:${fingerprint(row.email)}`;
    if ((await this.limits.count(emailKey, HOUR)) >= SENDS_PER_EMAIL) throw THROTTLED;
    await this.limits.hit(emailKey, HOUR);

    const now = new Date();
    let outgoing: EmailMessage | null = null;
    let data: Prisma.EmailChallengeUpdateInput = { sentAt: now, sendCount: { increment: 1 }, attempts: 0 };
    if (typeof message === 'function') {
      const code = newCode();
      outgoing = message(code);
      // Replaces any earlier code: only the newest one works.
      data = {
        ...data,
        codeHash: codeHash(row.id, code),
        codeExpiresAt: new Date(now.getTime() + OTP_TTL_SECONDS * 1000),
      };
    } else if (message) {
      outgoing = message.fixed;
    }
    const updated = await this.prisma.emailChallenge.update({ where: { id: row.id }, data });
    if (outgoing) {
      try {
        await this.email.sendNow(outgoing);
      } catch (error) {
        log('warn', 'challenge_email_failed', { purpose: row.purpose, error: (error as Error).message.slice(0, 200) });
        // Not sent, so it must not count against the resend wait.
        await this.prisma.emailChallenge.update({ where: { id: row.id }, data: { sentAt: null, codeHash: null } });
        throw error instanceof EmailUnavailableError ? NOT_CONFIGURED : SEND_FAILED;
      }
    }
    return this.respond(updated);
  }

  /**
   * Checks a code. Each wrong try is counted atomically before the comparison, so parallel guesses cannot exceed
   * the limit. A right code is cleared at once, so it cannot be replayed.
   */
  async verify(challengeId: string, purpose: ChallengePurpose, code: string, ip: string): Promise<Row> {
    const ipKey = `challenge:check:${fingerprint(ip)}`;
    if ((await this.limits.count(ipKey, HOUR)) >= CHECKS_PER_IP()) throw THROTTLED;
    await this.limits.hit(ipKey, HOUR);

    const claimed = await this.prisma.$queryRaw<Row[]>`
      UPDATE email_challenges SET attempts = attempts + 1
      WHERE id = ${challengeId}::uuid AND purpose = ${purpose} AND verified_at IS NULL AND consumed_at IS NULL
        AND attempts < ${OTP_MAX_ATTEMPTS}
      RETURNING id, code_hash AS "codeHash", code_expires_at AS "codeExpiresAt", attempts`;
    const row = claimed[0];
    if (!row) {
      const existing = await this.prisma.emailChallenge.findFirst({ where: { id: challengeId, purpose } });
      if (existing && existing.attempts >= OTP_MAX_ATTEMPTS && !existing.verifiedAt) {
        throw new AppError(429, 'TOO_MANY_ATTEMPTS', 'Too many wrong codes. Ask for a new code.');
      }
      throw INVALID_CODE(0);
    }
    const left = OTP_MAX_ATTEMPTS - row.attempts;
    if (!row.codeHash) throw INVALID_CODE(left);
    if (!row.codeExpiresAt || row.codeExpiresAt.getTime() <= Date.now()) {
      throw new AppError(410, 'CODE_EXPIRED', 'This code has expired. Ask for a new one.');
    }
    if (!sameHash(row.codeHash, codeHash(challengeId, code))) throw INVALID_CODE(left);

    const verified = await this.prisma.emailChallenge.updateMany({
      where: { id: challengeId, verifiedAt: null, codeHash: row.codeHash },
      data: { verifiedAt: new Date(), codeHash: null },
    });
    if (verified.count !== 1) throw INVALID_CODE(0);
    await this.limits.clear(`challenge:email:${fingerprint((await this.load(challengeId)).email)}`);
    return this.load(challengeId);
  }

  private load(id: string): Promise<Row> {
    return this.prisma.emailChallenge.findUniqueOrThrow({ where: { id } });
  }

  /** A single-use permission to finish sign-up, handed out once the address is proved. */
  async issueSetupToken(challengeId: string): Promise<{ setupToken: string; expiresAt: string }> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SETUP_TOKEN_TTL_SECONDS * 1000);
    await this.prisma.emailChallenge.update({
      where: { id: challengeId },
      data: { setupTokenHash: hashToken(token), setupExpiresAt: expiresAt },
    });
    return { setupToken: token, expiresAt: expiresAt.toISOString() };
  }

  findBySetupToken(token: string) {
    return this.prisma.emailChallenge.findFirst({
      where: {
        setupTokenHash: hashToken(token),
        purpose: 'REGISTRATION',
        verifiedAt: { not: null },
        consumedAt: null,
        setupExpiresAt: { gt: new Date() },
      },
    });
  }

  /** Details typed at sign-up are kept only until a day after they were entered. */
  async purgeStale(): Promise<number> {
    const result = await this.prisma.emailChallenge.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - 24 * 3_600_000) } },
    });
    return result.count;
  }
}
