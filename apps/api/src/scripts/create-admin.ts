import argon2 from 'argon2';
import { createAdapter } from '../db/prisma.service.js';
import { newTemporaryPassword } from '../common/crypto.js';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Safe first-administrator provisioning. Nothing ships with a default password: this prints a
 * temporary one once. On first sign-in the administrator must replace it and enrol in MFA.
 *
 * Usage: npm run admin:create -- <loginId> "<Full Name>"
 */
const [loginIdArg, nameArg] = process.argv.slice(2);
if (!loginIdArg || !nameArg) {
  console.error('Usage: npm run admin:create -- <loginId> "<Full Name>"');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: createAdapter(2) });

async function main(): Promise<void> {
  const loginId = (loginIdArg as string).toLowerCase();
  const existing = await prisma.user.findUnique({ where: { loginId } });
  if (existing) {
    console.error(`${loginId} already exists. Nothing changed.`);
    process.exitCode = 1;
    return;
  }
  const temporaryPassword = newTemporaryPassword();
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        role: 'ADMIN',
        name: nameArg as string,
        loginId,
        passwordHash: await argon2.hash(temporaryPassword, { type: argon2.argon2id }),
        mustChangePassword: true,
        tempPasswordExpiresAt: new Date(Date.now() + 24 * 3_600_000),
      },
    });
    await tx.auditLog.create({ data: { action: 'ADMIN_PROVISIONED', targetType: 'user', targetId: user.id } });
  });
  console.log(`Administrator "${loginId}" created.`);
  console.log(`Temporary password (shown once, valid 24 hours): ${temporaryPassword}`);
  console.log('You will be asked to change it and set up two-step verification when you first sign in.');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
