import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { ChallengeResponse, completeRegistrationSchema, registrationSchema } from '@signaldesk/domain';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { AuthService } from '../auth/auth.service.js';
import { AppError } from '../common/http.js';
import { isUniqueViolation, Prisma, PrismaService, TX_OPTIONS } from '../db/prisma.service.js';
import { accountExistsEmail, codeEmail } from '../email/messages.js';
import { SettingsService } from '../settings/settings.service.js';
import { EmailChallengeService } from './email-challenge.service.js';

type Registration = z.output<typeof registrationSchema>;
type Completion = z.output<typeof completeRegistrationSchema>;

interface Details {
  firstName: string;
  lastName: string;
  mobile: string;
  age: number;
  consentAt: string;
}

/**
 * Self-registration: details, then a code sent to the address, then a password. The account can sign in at once
 * but has no access to signals; a subscription or trial comes only from an administrator.
 */
@Injectable()
export class RegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly challenges: EmailChallengeService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  /** Any account already using this address, by login ID or contact email. */
  private existingAccount(email: string) {
    return this.prisma.user.findFirst({
      where: { OR: [{ loginId: email }, { email: { equals: email, mode: 'insensitive' } }] },
      select: { id: true, role: true, status: true },
    });
  }

  /** The same answer whether or not the address is taken; a taken address is told so by email instead. */
  async start(input: Registration, ip: string): Promise<ChallengeResponse> {
    const { serviceName, signupOpen } = await this.settings.get();
    // The same answer for everyone, so it says nothing about whether an address has an account.
    if (!signupOpen) {
      throw new AppError(403, 'SIGNUP_CLOSED', 'New sign-ups are paused. Contact support to join.');
    }
    const existing = await this.existingAccount(input.email);
    if (existing) {
      return this.challenges.issue({
        purpose: 'REGISTRATION',
        email: input.email,
        ip,
        userId: existing.id,
        message: { fixed: accountExistsEmail(input.email, serviceName) },
      });
    }
    const details: Details = {
      firstName: input.firstName,
      lastName: input.lastName,
      mobile: input.mobile,
      age: input.age,
      consentAt: new Date().toISOString(),
    };
    return this.challenges.issue({
      purpose: 'REGISTRATION',
      email: input.email,
      ip,
      userId: null,
      details: { ...details },
      message: (code) => codeEmail(input.email, serviceName, code, 'REGISTRATION'),
    });
  }

  async resend(challengeId: string, ip: string): Promise<ChallengeResponse> {
    const row = await this.prisma.emailChallenge.findFirst({
      where: { id: challengeId, purpose: 'REGISTRATION' },
      select: { email: true, userId: true },
    });
    const { serviceName } = await this.settings.get();
    const email = row?.email ?? '';
    return this.challenges.resend(
      challengeId,
      'REGISTRATION',
      ip,
      row?.userId
        ? { fixed: accountExistsEmail(email, serviceName) }
        : (code) => codeEmail(email, serviceName, code, 'REGISTRATION'),
    );
  }

  async verify(challengeId: string, code: string, ip: string) {
    const row = await this.challenges.verify(challengeId, 'REGISTRATION', code, ip);
    return this.challenges.issueSetupToken(row.id);
  }

  /** Creates the account. A setup token works once; a repeat is told the account already exists. */
  async complete(input: Completion) {
    const challenge = await this.challenges.findBySetupToken(input.setupToken);
    if (!challenge || challenge.userId || !challenge.details) {
      throw new AppError(410, 'SETUP_EXPIRED', 'This sign-up has expired or was already completed. Start again.');
    }
    const details = challenge.details as unknown as Details;
    const email = challenge.email;
    this.auth.validateNewPassword(input.password, email.split('@')[0] ?? email);
    const passwordHash = await this.auth.hashPassword(input.password);
    try {
      await this.prisma.$transaction(async (tx) => {
        const claim = await tx.emailChallenge.updateMany({
          where: { id: challenge.id, consumedAt: null },
          data: { consumedAt: new Date() },
        });
        if (claim.count !== 1)
          throw new AppError(409, 'ALREADY_REGISTERED', 'This account was already created. Log in.');
        const now = new Date();
        const user = await tx.user.create({
          data: {
            id: randomUUID(),
            role: 'SUBSCRIBER',
            name: `${details.firstName} ${details.lastName}`,
            firstName: details.firstName,
            lastName: details.lastName,
            email,
            phone: details.mobile,
            age: details.age,
            loginId: email,
            passwordHash,
            mustChangePassword: false,
            emailVerifiedAt: challenge.verifiedAt,
            selfRegisteredAt: now,
            privacyAcceptedAt: new Date(details.consentAt),
            enquiryStatus: 'NOT_CONTACTED',
          },
        });
        // What was typed at sign-up now lives on the account only.
        await tx.emailChallenge.update({
          where: { id: challenge.id },
          data: { details: Prisma.DbNull, userId: user.id },
        });
        await this.audit.record(
          {
            actorId: user.id,
            action: 'REGISTRATION_COMPLETED',
            targetType: 'user',
            targetId: user.id,
            metadata: { selfRegistered: true },
          },
          tx,
        );
      }, TX_OPTIONS);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(409, 'ALREADY_REGISTERED', 'This email address already has an account. Log in instead.');
      }
      throw error;
    }
    return { email };
  }

  /** Recovery. A code goes only to an address with an account; the answer is the same either way. */
  async startPasswordReset(email: string, ip: string): Promise<ChallengeResponse> {
    const { serviceName } = await this.settings.get();
    const user = await this.prisma.user.findFirst({
      where: {
        role: 'SUBSCRIBER',
        OR: [{ loginId: email }, { email: { equals: email, mode: 'insensitive' } }],
      },
      select: { id: true },
      orderBy: { emailVerifiedAt: { sort: 'desc', nulls: 'last' } },
    });
    return this.challenges.issue({
      purpose: 'PASSWORD_RESET',
      email,
      ip,
      userId: user?.id ?? null,
      message: user ? (code) => codeEmail(email, serviceName, code, 'PASSWORD_RESET') : null,
    });
  }

  async resendPasswordReset(challengeId: string, ip: string): Promise<ChallengeResponse> {
    const row = await this.prisma.emailChallenge.findFirst({
      where: { id: challengeId, purpose: 'PASSWORD_RESET' },
      select: { email: true, userId: true },
    });
    const { serviceName } = await this.settings.get();
    return this.challenges.resend(
      challengeId,
      'PASSWORD_RESET',
      ip,
      row?.userId ? (code) => codeEmail(row.email, serviceName, code, 'PASSWORD_RESET') : null,
    );
  }

  /** A proved address files one request for an administrator. A second request while one is open is the same request. */
  async verifyPasswordReset(challengeId: string, code: string, ip: string): Promise<{ status: 'REQUESTED' }> {
    const row = await this.challenges.verify(challengeId, 'PASSWORD_RESET', code, ip);
    if (!row.userId) throw new AppError(422, 'INVALID_CODE', 'That code is not right.');
    await this.prisma.emailChallenge.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
    const open = await this.prisma.passwordResetRequest.findFirst({
      where: { userId: row.userId, status: { in: ['OPEN', 'PASSWORD_ISSUED'] } },
    });
    if (open) return { status: 'REQUESTED' };
    try {
      await this.prisma.$transaction(async (tx) => {
        const request = await tx.passwordResetRequest.create({
          data: {
            id: randomUUID(),
            userId: row.userId as string,
            email: row.email,
            verifiedAt: row.verifiedAt ?? new Date(),
          },
        });
        await this.audit.record(
          {
            actorId: row.userId,
            action: 'PASSWORD_RESET_REQUESTED',
            targetType: 'password_reset_request',
            targetId: request.id,
          },
          tx,
        );
      });
    } catch (error) {
      // A parallel request won the race; there is one open request either way.
      if (!isUniqueViolation(error)) throw error;
    }
    return { status: 'REQUESTED' };
  }
}
