import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { generate } from 'otplib';
import webpush from 'web-push';
import type { TestProject } from 'vitest/node';

const PG_PORT = 54377;
const API_PORT = 4101;
const GATED_API_PORT = 4102;
const CONTROL_PORT = 4103;
const PUSH_PORT = 4104;
const LIMITED_API_PORT = 4105;
const ORIGIN = 'http://app.test';

declare module 'vitest' {
  export interface ProvidedContext {
    ctx: {
      api: string;
      gatedApi: string;
      limitedApi: string;
      control: string;
      pushBase: string;
      ws: string;
      origin: string;
      databaseUrl: string;
      adminCookie: string;
      adminId: string;
    };
  }
}

interface PushRecord {
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  status: number;
}

const apiDir = resolve(import.meta.dirname, '..');

async function waitForReady(url: string, label: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${label} did not become ready`);
}

async function json(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const dataDir = mkdtempSync(join(tmpdir(), 'sd-test-pg-'));
  const certDir = mkdtempSync(join(tmpdir(), 'sd-test-cert-'));
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
  await pg.createDatabase('signaldesk_test');
  const databaseUrl = `postgresql://signaldesk:signaldesk@localhost:${PG_PORT}/signaldesk_test`;

  const vapid = webpush.generateVAPIDKeys();
  const baseEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    APP_ORIGINS: ORIGIN,
    TRUST_PROXY_HOPS: '0',
    APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    PUSH_TRANSPORT: 'webpush',
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: 'mailto:test@example.test',
    PUSH_ENDPOINT_ALLOWLIST: 'localhost,fcm.googleapis.com',
    NODE_TLS_REJECT_UNAUTHORIZED: '0',
    WORKER_POLL_MS: '200',
    WORKER_LOCK_TIMEOUT_SECONDS: '4',
    RUN_WORKER_IN_API: 'false',
    PUBLIC_PERFORMANCE_ENABLED: 'false',
    RATE_LIMIT_PER_MINUTE: '1000000',
  };

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: apiDir, env: baseEnv, stdio: 'pipe' });
  execFileSync('node', ['dist/scripts/seed.js'], { cwd: apiDir, env: baseEnv, stdio: 'pipe' });

  // Mock push service with TLS, because the web-push library only speaks HTTPS.
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '2',
      '-keyout',
      join(certDir, 'key.pem'),
      '-out',
      join(certDir, 'cert.pem'),
      '-subj',
      '/CN=localhost',
    ],
    { stdio: 'pipe' },
  );
  const pushLog: PushRecord[] = [];
  const flakyCounts = new Map<string, number>();
  const pushServer = createTlsServer(
    { key: readFileSync(join(certDir, 'key.pem')), cert: readFileSync(join(certDir, 'cert.pem')) },
    (req, res) => {
      void json(req).then((body) => {
        const path = req.url ?? '';
        let status = 201;
        if (path.startsWith('/gone/')) status = 410;
        if (path.startsWith('/reject/')) status = 400;
        if (path.startsWith('/flaky/')) {
          const seen = flakyCounts.get(path) ?? 0;
          flakyCounts.set(path, seen + 1);
          status = seen < 2 ? 503 : 201;
        }
        pushLog.push({ path, headers: req.headers, body: body.toString('base64'), status });
        res.writeHead(status);
        res.end();
      });
    },
  );
  await new Promise<void>((r) => pushServer.listen(PUSH_PORT, r));

  const start = (entry: string, env: NodeJS.ProcessEnv): ChildProcess => {
    const child = spawn('node', [entry], { cwd: apiDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stderr?.on('data', (d: Buffer) => {
      const line = d.toString();
      if (process.env.SD_TEST_VERBOSE) process.stderr.write(line);
    });
    child.stdout?.on('data', (d: Buffer) => {
      if (process.env.SD_TEST_VERBOSE) process.stdout.write(d);
    });
    return child;
  };
  const stopChild = (child: ChildProcess | null, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> =>
    new Promise((r) => {
      if (!child || child.exitCode !== null) return r();
      child.once('exit', () => r());
      child.kill(signal);
    });

  const api = start('dist/main.js', { ...baseEnv, PORT: String(API_PORT), INSTANCE_ID: 'api-1' });
  const gatedApi = start('dist/main.js', {
    ...baseEnv,
    PORT: String(GATED_API_PORT),
    PUBLIC_PERFORMANCE_ENABLED: 'true',
    INSTANCE_ID: 'api-gated',
  });
  const limitedApi = start('dist/main.js', {
    ...baseEnv,
    PORT: String(LIMITED_API_PORT),
    INSTANCE_ID: 'api-limited',
    RATE_LIMIT_PER_MINUTE: '20',
  });
  let worker: ChildProcess | null = start('dist/worker.js', { ...baseEnv, INSTANCE_ID: 'worker-1' });
  let secondWorker: ChildProcess | null = null;
  await waitForReady(`http://localhost:${API_PORT}/health/ready`, 'API');
  await waitForReady(`http://localhost:${GATED_API_PORT}/health/ready`, 'Gated API');
  await waitForReady(`http://localhost:${LIMITED_API_PORT}/health/ready`, 'Limited API');

  // Test administrator: same path a real one follows.
  const output = execFileSync('node', ['dist/scripts/create-admin.js', 'root.admin', 'Root Admin'], {
    cwd: apiDir,
    env: baseEnv,
    encoding: 'utf8',
  });
  const temp = /valid 24 hours\): (\S+)/.exec(output)?.[1];
  if (!temp) throw new Error('Could not read the temporary password');
  const api1 = `http://localhost:${API_PORT}/api/v1`;
  const call = async (path: string, body: unknown, cookie?: string) =>
    fetch(`${api1}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
  const login = await call('/auth/login', { identifier: 'root.admin', password: temp });
  const adminCookie = (login.headers.get('set-cookie') ?? '').split(';')[0] as string;
  await call('/auth/change-password', { currentPassword: temp, newPassword: 'correct-horse-battery' }, adminCookie);
  const setup = (await (await call('/auth/mfa/setup', {}, adminCookie)).json()) as { secret: string };
  const code = await generate({ secret: setup.secret });
  const enabled = await call('/auth/mfa/enable', { code }, adminCookie);
  if (!enabled.ok) throw new Error(`MFA setup failed: ${await enabled.text()}`);
  const me = (await (await fetch(`${api1}/auth/me`, { headers: { cookie: adminCookie } })).json()) as {
    id: string;
    next: unknown;
  };
  if (me.next !== null) throw new Error('Admin session incomplete');

  // Lets test files stop and start services that live in this process.
  const control: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const reply = (value: unknown) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    void (async () => {
      switch (req.url) {
        case '/push-log':
          return reply(pushLog);
        case '/worker/kill':
          await stopChild(worker, 'SIGKILL');
          worker = null;
          return reply({ ok: true });
        case '/worker/start':
          worker ??= start('dist/worker.js', { ...baseEnv, INSTANCE_ID: `worker-${Date.now()}` });
          return reply({ ok: true });
        case '/worker/second/start':
          secondWorker ??= start('dist/worker.js', { ...baseEnv, INSTANCE_ID: 'worker-second' });
          return reply({ ok: true });
        case '/worker/second/stop':
          await stopChild(secondWorker);
          secondWorker = null;
          return reply({ ok: true });
        case '/pg/stop':
          await pg.stop();
          return reply({ ok: true });
        case '/pg/start':
          await pg.start();
          return reply({ ok: true });
        default:
          res.writeHead(404);
          res.end();
      }
    })();
  });
  await new Promise<void>((r) => control.listen(CONTROL_PORT, r));

  project.provide('ctx', {
    api: api1,
    gatedApi: `http://localhost:${GATED_API_PORT}/api/v1`,
    limitedApi: `http://localhost:${LIMITED_API_PORT}/api/v1`,
    control: `http://localhost:${CONTROL_PORT}`,
    pushBase: `https://localhost:${PUSH_PORT}`,
    ws: `ws://localhost:${API_PORT}/ws`,
    origin: ORIGIN,
    databaseUrl,
    adminCookie,
    adminId: me.id,
  });

  return async () => {
    await Promise.all([
      stopChild(api),
      stopChild(gatedApi),
      stopChild(limitedApi),
      stopChild(worker),
      stopChild(secondWorker),
    ]);
    await new Promise<void>((r) => control.close(() => r()));
    pushServer.closeAllConnections();
    await new Promise<void>((r) => pushServer.close(() => r()));
    await pg.stop().catch(() => undefined);
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(certDir, { recursive: true, force: true });
  };
}
