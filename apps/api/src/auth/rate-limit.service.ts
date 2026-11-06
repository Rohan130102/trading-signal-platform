import { Injectable } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service.js';

/** Fixed-window counters in PostgreSQL, so limits hold across API instances without Redis. */
@Injectable()
export class RateLimitService {
  constructor(private readonly prisma: PrismaService) {}

  async hit(key: string, windowSeconds: number): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO rate_limit_buckets (key, window_start, count) VALUES (${key}, now(), 1)
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN rate_limit_buckets.window_start < now() - make_interval(secs => ${windowSeconds}::double precision)
                     THEN 1 ELSE rate_limit_buckets.count + 1 END,
        window_start = CASE WHEN rate_limit_buckets.window_start < now() - make_interval(secs => ${windowSeconds}::double precision)
                     THEN now() ELSE rate_limit_buckets.window_start END
      RETURNING count`;
    return rows[0]?.count ?? 1;
  }

  async count(key: string, windowSeconds: number): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: number }[]>`
      SELECT count FROM rate_limit_buckets
      WHERE key = ${key} AND window_start >= now() - make_interval(secs => ${windowSeconds}::double precision)`;
    return rows[0]?.count ?? 0;
  }

  async clear(key: string): Promise<void> {
    await this.prisma.rateLimitBucket.deleteMany({ where: { key } });
  }
}
