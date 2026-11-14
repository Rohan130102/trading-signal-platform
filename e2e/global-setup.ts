import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import webpush from 'web-push';
import { API_ORIGIN, API_PORT, WEB_ORIGIN, WEB_PORT } from './ports.js';

const root = resolve(import.meta.dirname, '..');
const apiDir = resolve(root, 'apps/api');
const webDir = resolve(root, 'apps/web/.next/standalone/apps/web');
const PG_PORT = 54388;

async function ready(url: string, label: string): Promise<void> {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${label} did not start`);
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const dataDir = mkdtempSync(join(tmpdir(), 'sd-e2e-pg-'));
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
  await pg.createDatabase('signaldesk_e2e');
  const databaseUrl = `postgresql://signaldesk:signaldesk@localhost:${PG_PORT}/signaldesk_e2e`;
  const vapid = webpush.generateVAPIDKeys();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    PORT: String(API_PORT),
    APP_ORIGINS: WEB_ORIGIN,
    TRUST_PROXY_HOPS: '1',
    APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    PUSH_TRANSPORT: 'webpush',
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: 'mailto:e2e@example.test',
    WORKER_POLL_MS: '500',
    RUN_WORKER_IN_API: 'false',
    RATE_LIMIT_PER_MINUTE: '1000000',
    // Nothing leaves this machine: the only allowed push host refuses connections.
    PUSH_ENDPOINT_ALLOWLIST: 'localhost',
  };
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: apiDir, env, stdio: 'pipe' });
  execFileSync('node', ['dist/scripts/seed.js'], { cwd: apiDir, env, stdio: 'pipe' });
  const output = execFileSync('node', ['dist/scripts/create-admin.js', 'owner', 'Owner Admin'], {
    cwd: apiDir,
    env,
    encoding: 'utf8',
  });
  const temp = /valid 24 hours\): (\S+)/.exec(output)?.[1];
  if (!temp) throw new Error('No temporary password');

  mkdirSync(resolve(root, 'e2e/.state'), { recursive: true });
  writeFileSync(resolve(root, 'e2e/.state/admin.json'), JSON.stringify({ login: 'owner', temp, databaseUrl }));

  const children: ChildProcess[] = [
    spawn('node', ['dist/main.js'], { cwd: apiDir, env, stdio: 'ignore' }),
    spawn('node', ['dist/worker.js'], { cwd: apiDir, env, stdio: 'ignore' }),
    spawn('node', ['server.js'], {
      cwd: webDir,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(WEB_PORT),
        HOSTNAME: 'localhost',
        API_ORIGIN,
        NEXT_PUBLIC_WS_URL: `ws://localhost:${API_PORT}/ws`,
      },
      stdio: 'ignore',
    }),
  ];
  await ready(`${API_ORIGIN}/health/ready`, 'API');
  await ready(`${WEB_ORIGIN}/login`, 'Web');

  return async () => {
    for (const child of children) child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 800));
    await pg.stop().catch(() => undefined);
    rmSync(dataDir, { recursive: true, force: true });
  };
}
