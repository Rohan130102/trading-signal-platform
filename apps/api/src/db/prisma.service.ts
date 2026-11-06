import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env.js';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';

export type Tx = Prisma.TransactionClient;
export { Prisma };

export const TX_OPTIONS = { maxWait: 5000, timeout: 15000 };

/**
 * UTC is mandatory, not a preference: the driver sends timestamps without an offset, so any other
 * session timezone would corrupt every stored instant (see the 20261105000200_utc migration).
 */
export function createAdapter(max = 15): PrismaPg {
  return new PrismaPg({ connectionString: env.DATABASE_URL, max, options: '-c TimeZone=UTC' });
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({ adapter: createAdapter() });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

export function isUniqueViolation(error: unknown, target?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  if (!target) return true;
  return JSON.stringify(error.meta ?? {}).includes(target);
}

export function str(value: Prisma.Decimal): string;
export function str(value: Prisma.Decimal | null | undefined): string | null;
export function str(value: Prisma.Decimal | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toFixed();
}
