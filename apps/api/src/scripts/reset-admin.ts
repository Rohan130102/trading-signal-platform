import { createAdapter } from '../db/prisma.service.js';
import { newTemporaryPassword } from '../common/crypto.js';
import { PrismaClient } from '../generated/prisma/client.js';
import argon2 from 'argon2';

/**
 * Break-glass recovery for an administrator who lost their password and recovery codes. It needs
 * shell and database access, so it sits outside the application's own permissions. It ends every
 * session, clears MFA so it must be enrolled again, and leaves an audit record.
 *
 * Usage: npm run admin:reset -- <loginId>
 */
const [loginIdArg] = process.argv.slice(2);
if (!loginIdArg) {
  console.error('Usage: npm run admin:reset -- <loginId>');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: createAdapter(2) });

async function main(): Promise<void> {
  const loginId = (loginIdArg as string).toLowerCase();
  const user = await prisma.user.findUnique({ where: { loginId } });
  if (!user || user.role !== 'ADMIN') {
    console.error(`No administrator named ${loginId}. Nothing changed.`);
    process.exitCode = 1;
    return;
  }
  const temporaryPassword = newTemporaryPassword();
  const passwordHash = await argon2.hash(temporaryPassword, { type: argon2.argon2id });
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        mustChangePassword: true,
        tempPasswordExpiresAt: new Date(Date.now() + 24 * 3_600_000),
        mfaSecretEnc: null,
        mfaEnabledAt: null,
        mfaLastStep: null,
      },
    });
    await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
    await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.auditLog.create({ data: { action: 'ADMIN_RESET_FROM_CLI', targetType: 'user', targetId: user.id } });
  });
  console.log(`Temporary password for "${loginId}" (shown once, valid 24 hours): ${temporaryPassword}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
