import { createAdapter } from '../db/prisma.service.js';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Break-glass: makes an active administrator the Master Admin, for when no Master Admin can sign in. It needs
 * shell and database access, so it sits outside the application's own permissions, and it leaves an audit record.
 * In normal operation the Master Admin grants and transfers the role in the app.
 *
 * Usage: npm run admin:make-master -- <loginId>
 */
const [loginIdArg] = process.argv.slice(2);
if (!loginIdArg) {
  console.error('Usage: npm run admin:make-master -- <loginId>');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: createAdapter(2) });

async function main(): Promise<void> {
  const loginId = (loginIdArg as string).toLowerCase();
  const user = await prisma.user.findUnique({ where: { loginId } });
  if (!user || user.role !== 'ADMIN' || user.status !== 'ACTIVE') {
    console.error(`No active administrator named ${loginId}. Nothing changed.`);
    process.exitCode = 1;
    return;
  }
  if (user.isMasterAdmin) {
    console.log(`${loginId} is already a Master Admin. Nothing changed.`);
    return;
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { isMasterAdmin: true } });
    await tx.auditLog.create({
      data: { action: 'MASTER_ADMIN_GRANTED_FROM_CLI', targetType: 'user', targetId: user.id },
    });
  });
  console.log(`${loginId} is now a Master Admin.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
