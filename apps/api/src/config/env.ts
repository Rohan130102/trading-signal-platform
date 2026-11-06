import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

for (const candidate of ['.env', '../../.env']) {
  const path = resolve(process.cwd(), candidate);
  if (existsSync(path)) {
    process.loadEnvFile(path);
    break;
  }
}

const flag = (fallback: boolean) =>
  z
    .enum(['true', 'false'])
    .default(fallback ? 'true' : 'false')
    .transform((v) => v === 'true');

const list = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().min(1),
    PORT: z.coerce.number().int().default(4000),
    /** Browser origins allowed to make state-changing requests and open WebSockets. */
    APP_ORIGINS: list('http://localhost:3000'),
    /** Reverse proxies in front of the API, so the client IP is read correctly. */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),
    /** Base64, 32 bytes. Encrypts MFA secrets at rest. */
    APP_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'APP_ENCRYPTION_KEY must be 32 bytes, base64 encoded'),
    PUSH_TRANSPORT: z.enum(['webpush', 'log', 'disabled']).default('disabled'),
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z.string().optional(),
    /** Hosts a subscriber's device may name as its push endpoint. Blocks SSRF through the push worker. */
    PUSH_ENDPOINT_ALLOWLIST: list(
      'fcm.googleapis.com,updates.push.services.mozilla.com,*.push.services.mozilla.com,web.push.apple.com,*.push.apple.com,*.notify.windows.com',
    ),
    /** Second key for the public performance gate. Useless without a current approval record. */
    PUBLIC_PERFORMANCE_ENABLED: flag(false),
    RUN_WORKER_IN_API: flag(false),
    /** Per client IP, per API instance. A first line of defence; the reverse proxy should also limit. */
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(600),
    WORKER_POLL_MS: z.coerce.number().int().min(50).default(2000),
    /** How long a crashed worker's claim blocks a job. Must comfortably exceed a push timeout (10 s). */
    WORKER_LOCK_TIMEOUT_SECONDS: z.coerce.number().int().min(1).default(60),
    SESSION_TTL_DAYS: z.coerce.number().int().min(1).default(30),
    ADMIN_SESSION_TTL_HOURS: z.coerce.number().int().min(1).default(12),
    ADMIN_IDLE_MINUTES: z.coerce.number().int().min(5).default(120),
    INSTANCE_ID: z.string().default(() => randomUUID().slice(0, 8)),
  })
  .superRefine((env, ctx) => {
    if (env.PUSH_TRANSPORT === 'webpush' && (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT)) {
      ctx.addIssue({
        code: 'custom',
        message: 'PUSH_TRANSPORT=webpush requires VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT',
      });
    }
    if (env.NODE_ENV === 'production' && env.APP_ORIGINS.some((o) => !o.startsWith('https://'))) {
      ctx.addIssue({ code: 'custom', message: 'In production every APP_ORIGINS entry must use https://' });
    }
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  ${i.path.join('.') || 'env'}: ${i.message}`);
  console.error(`Invalid environment configuration:\n${lines.join('\n')}`);
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
