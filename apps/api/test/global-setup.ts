import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
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
const EXPO_PORT = 4106;
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
      /** Where the API writes the emails it sends (EMAIL_TRANSPORT=file). */
      mailDir: string;
      /** Where app updates are published, and the public half of the key that signs them. */
      updatesDir: string;
      updatesPublicKey: string;
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
  const mailDir = mkdtempSync(join(tmpdir(), 'sd-test-mail-'));
  const updatesDir = mkdtempSync(join(tmpdir(), 'sd-test-updates-'));
  const updateKeys = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
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
    EXPO_PUSH_API_URL: `http://localhost:${EXPO_PORT}`,
    EXPO_RECEIPT_DELAY_SECONDS: '1',
    EXPO_RECEIPT_POLL_SECONDS: '1',
    NODE_TLS_REJECT_UNAUTHORIZED: '0',
    WORKER_POLL_MS: '200',
    WORKER_LOCK_TIMEOUT_SECONDS: '4',
    RUN_WORKER_IN_API: 'false',
    PUBLIC_PERFORMANCE_ENABLED: 'false',
    RATE_LIMIT_PER_MINUTE: '1000000',
    EMAIL_TRANSPORT: 'file',
    EMAIL_FILE_DIR: mailDir,
    EMAIL_FROM: 'Signal Desk <no-reply@example.test>',
    EMAIL_CODE_IP_LIMIT_PER_HOUR: '100000',
    APP_UPDATES_DIR: updatesDir,
    APP_UPDATES_SIGNING_KEY: Buffer.from(updateKeys.privateKey).toString('base64'),
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

  // Stands in for Expo's push service. A token's name decides how it behaves.
  const expoLog: { message: Record<string, unknown>; ticket: unknown; httpStatus: number }[] = [];
  const expoReceipts = new Map<string, unknown>();
  const expoSeen = new Map<string, number>();
  /** How many messages arrived in each request. */
  const expoRequests: number[] = [];
  const expoServer = createServer((req, res) => {
    void json(req).then((raw) => {
      const body = JSON.parse(raw.toString() || '{}') as { ids?: string[] } | Record<string, unknown>[];
      const reply = (status: number, value: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(value));
      };
      if (req.url === '/getReceipts') {
        const ids = (body as { ids: string[] }).ids;
        return reply(200, {
          data: Object.fromEntries(ids.filter((id) => expoReceipts.has(id)).map((id) => [id, expoReceipts.get(id)])),
        });
      }
      const messages = body as Record<string, unknown>[];
      expoRequests.push(messages.length);
      if (messages.length > 100) {
        return reply(400, { errors: [{ code: 'PUSH_TOO_MANY_NOTIFICATIONS', message: 'at most 100' }] });
      }
      // Expo sends none of a request that mixes tokens from more than one project.
      if (messages.length > 1 && messages.some((m) => String(m.to).includes('[otherproject'))) {
        return reply(400, { errors: [{ code: 'PUSH_TOO_MANY_EXPERIENCE_IDS', message: 'mixed projects' }] });
      }
      const unseen = (m: Record<string, unknown>, kind: string) =>
        String(m.to).includes(`[${kind}`) && !expoSeen.has(String(m.to));
      const failing = messages.find((m) => unseen(m, 'http500'));
      if (failing) {
        expoSeen.set(String(failing.to), 1);
        expoLog.push({ message: failing, ticket: null, httpStatus: 500 });
        return reply(500, { errors: [{ code: 'INTERNAL', message: 'try later' }] });
      }
      const shortReply = messages.find((m) => unseen(m, 'shorttickets'));
      if (shortReply) {
        expoSeen.set(String(shortReply.to), 1);
        return reply(200, { data: [] });
      }
      const tickets = messages.map((message) => {
        const token = String(message.to);
        const seen = expoSeen.get(token) ?? 0;
        expoSeen.set(token, seen + 1);
        let ticket: Record<string, unknown>;
        if (token.includes('[gone'))
          ticket = { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } };
        else if (token.includes('[toobig'))
          ticket = { status: 'error', message: 'big', details: { error: 'MessageTooBig' } };
        else if (token.includes('[otherproject'))
          ticket = { status: 'error', message: 'wrong project', details: { error: 'InvalidCredentials' } };
        else if (token.includes('[rate') && seen === 0)
          ticket = { status: 'error', message: 'slow', details: { error: 'MessageRateExceeded' } };
        else {
          const id = randomBytes(8).toString('hex');
          ticket = { status: 'ok', id };
          if (token.includes('[lategone'))
            expoReceipts.set(id, { status: 'error', details: { error: 'DeviceNotRegistered' } });
          else if (token.includes('[latefail'))
            expoReceipts.set(id, { status: 'error', details: { error: 'MismatchSenderId' } });
          else expoReceipts.set(id, { status: 'ok' });
        }
        expoLog.push({ message, ticket, httpStatus: 200 });
        return ticket;
      });
      return reply(200, { data: tickets });
    });
  });
  await new Promise<void>((r) => expoServer.listen(EXPO_PORT, r));

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
    EMAIL_CODE_IP_LIMIT_PER_HOUR: '3',
    // Lets a test say which address a request came from, as a reverse proxy would.
    TRUST_PROXY_HOPS: '1',
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
        case '/expo-log':
          return reply(expoLog);
        case '/expo-requests':
          return reply(expoRequests);
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
    mailDir,
    updatesDir,
    updatesPublicKey: updateKeys.publicKey,
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
    expoServer.closeAllConnections();
    await new Promise<void>((r) => expoServer.close(() => r()));
    pushServer.closeAllConnections();
    await new Promise<void>((r) => pushServer.close(() => r()));
    await pg.stop().catch(() => undefined);
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(certDir, { recursive: true, force: true });
    rmSync(mailDir, { recursive: true, force: true });
    rmSync(updatesDir, { recursive: true, force: true });
  };
}
