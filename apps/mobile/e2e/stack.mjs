// A complete, disposable back end for testing the app: real PostgreSQL, real API, real worker, and a
// local stand-in for Expo's push service. Nothing here touches your development database.
//
//   node apps/mobile/e2e/stack.mjs
//
// Credentials for the test accounts are written to apps/mobile/e2e/.state.json, which git ignores.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(here, '../../api');
const require = createRequire(join(apiDir, 'package.json'));
const { default: EmbeddedPostgres } = await import(require.resolve('embedded-postgres'));
const { generate } = await import(require.resolve('otplib'));

const API_PORT = Number(process.env.STACK_API_PORT ?? 4200);
const EXPO_PORT = API_PORT + 6;
const PG_PORT = API_PORT + 50000 > 65000 ? 54390 : 54390;
const api = `http://localhost:${API_PORT}/api/v1`;
const PASSWORD = 'correct-horse-battery-staple';

const dataDir = mkdtempSync(join(tmpdir(), 'sd-mobile-pg-'));
const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'signaldesk',
  password: 'signaldesk',
  port: PG_PORT,
  persistent: true,
  onLog: () => {},
  onError: () => {},
});
await pg.initialise();
await pg.start();
await pg.createDatabase('signaldesk_mobile');
const databaseUrl = `postgresql://signaldesk:signaldesk@localhost:${PG_PORT}/signaldesk_mobile`;

const env = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: databaseUrl,
  PORT: String(API_PORT),
  APP_ORIGINS: 'http://app.test',
  TRUST_PROXY_HOPS: '0',
  APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  PUSH_TRANSPORT: 'disabled',
  EXPO_PUSH_API_URL: `http://localhost:${EXPO_PORT}`,
  EXPO_RECEIPT_DELAY_SECONDS: '1',
  EXPO_RECEIPT_POLL_SECONDS: '1',
  WORKER_POLL_MS: '200',
  RUN_WORKER_IN_API: 'false',
  PUBLIC_PERFORMANCE_ENABLED: 'false',
  RATE_LIMIT_PER_MINUTE: '1000000',
};
execFileSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: apiDir, env, stdio: 'pipe' });
execFileSync('node', ['dist/scripts/seed.js'], { cwd: apiDir, env, stdio: 'pipe' });
const provision = (login, name) => {
  const out = execFileSync('node', ['dist/scripts/create-admin.js', login, name], { cwd: apiDir, env }).toString();
  return /: (\S+)\s*$/m.exec(out.split('\n').find((line) => line.startsWith('Temporary')) ?? '')?.[1];
};
const adminTemp = provision('admin', 'Test Administrator');
const freshAdminTemp = provision('newadmin', 'New Administrator');

// Stands in for Expo's push service, and remembers what it was given.
const pushLog = [];
const expo = createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    res.setHeader('content-type', 'application/json');
    if (req.url === '/log') return res.end(JSON.stringify(pushLog));
    if (req.url === '/getReceipts') {
      return res.end(JSON.stringify({ data: Object.fromEntries(body.ids.map((id) => [id, { status: 'ok' }])) }));
    }
    pushLog.push(body[0]);
    return res.end(JSON.stringify({ data: [{ status: 'ok', id: randomUUID() }] }));
  });
});
await new Promise((r) => expo.listen(EXPO_PORT, r));

const children = [
  spawn('node', ['dist/main.js'], { cwd: apiDir, env, stdio: 'inherit' }),
  spawn('node', ['dist/worker.js'], { cwd: apiDir, env, stdio: 'inherit' }),
];

const deadline = Date.now() + 30_000;
for (;;) {
  try {
    if ((await fetch(`http://localhost:${API_PORT}/health/ready`)).ok) break;
  } catch {
    // Not up yet.
  }
  if (Date.now() > deadline) throw new Error('API did not start');
  await new Promise((r) => setTimeout(r, 200));
}

async function call(token, method, path, body) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
  return parsed;
}

// Finish the first administrator's onboarding, so most tests can start from a signed-in desk.
const { token: adminToken } = await call(null, 'POST', '/auth/token', { identifier: 'admin', password: adminTemp });
await call(adminToken, 'POST', '/auth/change-password', { currentPassword: adminTemp, newPassword: PASSWORD });
const { token: adminToken2 } = await call(null, 'POST', '/auth/token', { identifier: 'admin', password: PASSWORD });
const { secret } = await call(adminToken2, 'POST', '/auth/mfa/setup', {});
await call(adminToken2, 'POST', '/auth/mfa/enable', { code: await generate({ secret }) });

// One subscriber who has finished setting up, and one who has only a temporary password.
const makeSubscriber = async (name, loginId, durationDays = 30) => {
  const made = await call(adminToken2, 'POST', '/admin/subscribers', {
    name,
    loginId,
    durationDays,
    idempotencyKey: randomUUID(),
  });
  return { id: made.subscriber.id, loginId, temporaryPassword: made.temporaryPassword };
};
const subscriber = await makeSubscriber('Asha Rao', 'asha');
const { token: subToken } = await call(null, 'POST', '/auth/token', {
  identifier: 'asha',
  password: subscriber.temporaryPassword,
});
await call(subToken, 'POST', '/auth/change-password', {
  currentPassword: subscriber.temporaryPassword,
  newPassword: PASSWORD,
});
const newcomer = await makeSubscriber('Vikram Shah', 'vikram');

writeFileSync(
  join(here, '.state.json'),
  JSON.stringify(
    {
      apiPort: API_PORT,
      expoPort: EXPO_PORT,
      adminToken: adminToken2,
      password: PASSWORD,
      totpSecret: secret,
      freshAdminTemp,
      subscriber: { ...subscriber, temporaryPassword: undefined },
      newcomer,
    },
    null,
    2,
  ),
);
console.warn(`stack ready on port ${API_PORT}`);

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  expo.close();
  await pg.stop().catch(() => undefined);
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
