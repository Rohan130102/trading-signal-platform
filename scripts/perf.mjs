// Measures what the product actually promises, on this machine, against a real stack: its own
// PostgreSQL, one API process and one worker. Every number it prints is measured, none is assumed.
//
//   ulimit -n 20000 && SOCKETS=1000 EVENTS=100 DEVICES=500 npm run test:perf
//
// Run after `npm run build`. Results go to stdout and test-results/perf.json.
import { execFileSync, spawn } from 'node:child_process';
import { createECDH, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { generate } from 'otplib';
import pg from 'pg';
import webpush from 'web-push';
import { WebSocket } from 'ws';

const SOCKETS = Number(process.env.SOCKETS ?? 1000);
const EVENTS = Number(process.env.EVENTS ?? 100);
const DEVICES = Number(process.env.DEVICES ?? 500);
const GAP_MS = Number(process.env.GAP_MS ?? 100);
const PG_PORT = 54399;
const API_PORT = 4301;
const PUSH_PORT = 4302;
const ORIGIN = 'http://perf.test';
const root = resolve(import.meta.dirname, '..');
const apiDir = resolve(root, 'apps/api');
const API = `http://localhost:${API_PORT}/api/v1`;

const pct = (values, p) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)].toFixed(1));
};
const summary = (values) => ({
  samples: values.length,
  p50: pct(values, 50),
  p95: pct(values, 95),
  p99: pct(values, 99),
  max: pct(values, 100),
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dataDir = mkdtempSync(join(tmpdir(), 'sd-perf-pg-'));
const certDir = mkdtempSync(join(tmpdir(), 'sd-perf-cert-'));
const db = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'signaldesk',
  password: 'signaldesk',
  port: PG_PORT,
  persistent: true,
  onLog: () => {},
  onError: () => {},
});
const children = [];
let exitCode = 0;

try {
  await db.initialise();
  await db.start();
  await db.createDatabase('perf');
  const databaseUrl = `postgresql://signaldesk:signaldesk@localhost:${PG_PORT}/perf`;
  const vapid = webpush.generateVAPIDKeys();
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    PORT: String(API_PORT),
    APP_ORIGINS: ORIGIN,
    TRUST_PROXY_HOPS: '0',
    APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    PUSH_TRANSPORT: 'webpush',
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: 'mailto:perf@example.test',
    PUSH_ENDPOINT_ALLOWLIST: 'localhost',
    NODE_TLS_REJECT_UNAUTHORIZED: '0',
    RATE_LIMIT_PER_MINUTE: '100000000',
    RUN_WORKER_IN_API: 'false',
  };
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: apiDir, env, stdio: 'pipe' });
  execFileSync('node', ['dist/scripts/seed.js'], { cwd: apiDir, env, stdio: 'pipe' });
  const output = execFileSync('node', ['dist/scripts/create-admin.js', 'perf.admin', 'Perf Admin'], {
    cwd: apiDir,
    env,
    encoding: 'utf8',
  });
  const temp = /valid 24 hours\): (\S+)/.exec(output)[1];

  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-keyout',
      join(certDir, 'k.pem'),
      '-out',
      join(certDir, 'c.pem'),
      '-subj',
      '/CN=localhost',
    ],
    { stdio: 'pipe' },
  );
  let pushesReceived = 0;
  let lastPushAt = 0;
  const pushServer = createServer(
    { key: readFileSync(join(certDir, 'k.pem')), cert: readFileSync(join(certDir, 'c.pem')) },
    (req, res) => {
      req.resume();
      req.on('end', () => {
        pushesReceived += 1;
        lastPushAt = performance.now();
        res.writeHead(201);
        res.end();
      });
    },
  );
  await new Promise((r) => pushServer.listen(PUSH_PORT, r));

  const api = spawn('node', ['dist/main.js'], { cwd: apiDir, env, stdio: 'ignore' });
  const worker = spawn('node', ['dist/worker.js'], { cwd: apiDir, env, stdio: 'ignore' });
  children.push(api, worker);
  for (let i = 0; i < 200; i += 1) {
    try {
      if ((await fetch(`http://localhost:${API_PORT}/health/ready`)).ok) break;
    } catch {
      // Not up yet.
    }
    await sleep(100);
  }

  // A fully onboarded administrator, through the real API.
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(method !== 'GET' ? { origin: ORIGIN } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie?.startsWith('sd_session=')) cookie = setCookie.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  await call('POST', '/auth/login', { identifier: 'perf.admin', password: temp });
  await call('POST', '/auth/change-password', { currentPassword: temp, newPassword: 'perf-long-passphrase-9' });
  const setup = await call('POST', '/auth/mfa/setup');
  await call('POST', '/auth/mfa/enable', { code: await generate({ secret: setup.body.secret }) });
  const instruments = await call('GET', '/admin/instruments');
  const xau = instruments.body.instruments.find((i) => i.symbol === 'XAU/USD').id;

  // Password hashing is deliberately slow, so subscribers and sessions are inserted directly here.
  // Everything measured below still goes through the real authorization path.
  const sql = new pg.Client({ connectionString: databaseUrl, options: '-c TimeZone=UTC' });
  await sql.connect();
  const placeholderHash = '$argon2id$v=19$m=65536,t=3,p=4$cGVyZnBlcmZwZXJm$Pz6Vq9c6Yw0qg0J7Xh0m0wYz1x0m0wYz1x0m0wYz1x0';
  const tokens = [];
  const total = Math.max(SOCKETS, DEVICES);
  for (let i = 0; i < total; i += 200) {
    const batch = Array.from({ length: Math.min(200, total - i) }, (_, n) => ({
      id: randomUUID(),
      sessionId: randomUUID(),
      subId: randomUUID(),
      token: randomBytes(32).toString('base64url'),
      login: `perf${i + n}`,
    }));
    tokens.push(...batch);
    await sql.query(
      `INSERT INTO users (id, role, status, name, login_id, password_hash, must_change_password, updated_at)
      SELECT u.id, 'SUBSCRIBER', 'ACTIVE', 'Perf', u.login, $2, false, now() FROM jsonb_to_recordset($1::jsonb) AS u(id uuid, login text)`,
      [JSON.stringify(batch), placeholderHash],
    );
    await sql.query(
      `INSERT INTO subscriptions (id, user_id, starts_at, expires_at, updated_at)
      SELECT u."subId", u.id, now() - interval '1 day', now() + interval '30 days', now() FROM jsonb_to_recordset($1::jsonb) AS u(id uuid, "subId" uuid)`,
      [JSON.stringify(batch)],
    );
    await sql.query(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at)
      SELECT u."sessionId", u.id, u.hash, now() + interval '30 days' FROM jsonb_to_recordset($1::jsonb) AS u(id uuid, "sessionId" uuid, hash text)`,
      [JSON.stringify(batch.map((b) => ({ ...b, hash: createHash('sha256').update(b.token).digest('hex') })))],
    );
  }

  const results = {
    environment: {
      sockets: SOCKETS,
      events: EVENTS,
      devices: DEVICES,
      gapMs: GAP_MS,
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      note: 'Client, API, worker and database all on one machine, one API instance. Network to real devices is excluded.',
    },
  };

  // ---------- Open sockets ----------
  const perSocket = [];
  let connectFailures = 0;
  const openSocket = (token) =>
    new Promise((res) => {
      const ws = new WebSocket(`ws://localhost:${API_PORT}/ws`, {
        headers: { origin: ORIGIN, cookie: `sd_session=${token}` },
      });
      const received = [];
      perSocket.push(received);
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'hello', lastSeq: 0 }));
        res(ws);
      });
      ws.on('message', (raw) => {
        const message = JSON.parse(raw.toString());
        if (message.type === 'event') received.push(message.event.seq);
      });
      ws.on('error', () => {
        connectFailures += 1;
        res(null);
      });
    });
  const connectStart = performance.now();
  const sockets = [];
  for (let i = 0; i < SOCKETS; i += 100)
    sockets.push(...(await Promise.all(tokens.slice(i, i + 100).map((t) => openSocket(t.token)))));
  results.connections = {
    attempted: SOCKETS,
    open: sockets.filter(Boolean).length,
    failed: connectFailures,
    secondsToOpen: Number(((performance.now() - connectStart) / 1000).toFixed(1)),
  };
  const rss = () =>
    Number(
      (Number(execFileSync('ps', ['-o', 'rss=', '-p', String(api.pid)], { encoding: 'utf8' }).trim()) / 1024).toFixed(
        0,
      ),
    );
  results.connections.apiMemoryMbWithSockets = rss();
  await sleep(500);

  // ---------- Publish and live delivery ----------
  const publishTimes = [];
  const timeBySeq = new Map();
  for (let i = 0; i < EVENTS; i += 1) {
    const entry = 3000 + i * 7;
    const body = {
      instrumentId: xau,
      direction: 'BUY',
      entryType: 'SINGLE',
      entryLow: String(entry),
      entryHigh: String(entry),
      targets: [String(entry + 150)],
      stopLoss: String(entry - 180),
      idempotencyKey: randomUUID(),
    };
    const t0 = performance.now();
    const res = await call('POST', '/admin/signals', body);
    const elapsed = performance.now() - t0;
    if (res.status !== 201) throw new Error(`Publish failed: ${JSON.stringify(res.body)}`);
    publishTimes.push(elapsed);
    timeBySeq.set(res.body.trade.events[0].seq, t0);
    await sleep(GAP_MS);
  }
  results.publishLatencyMs = summary(publishTimes);

  // Completeness and order across every socket for everything published above.
  await sleep(1500);
  const expected = [...timeBySeq.keys()];
  let complete = 0;
  let inOrder = 0;
  for (const received of perSocket) {
    const seen = new Set(received);
    if (expected.every((s) => seen.has(s))) complete += 1;
    if (received.every((s, i) => i === 0 || s > received[i - 1])) inOrder += 1;
  }
  results.liveDelivery = {
    socketsReceivingEveryEvent: complete,
    socketsInStrictOrder: inOrder,
    sockets: perSocket.length,
  };

  // ---------- Per-delivery latency ----------
  // The API returns after commit and the fan-out may finish first, so arrival is timed against a clock
  // started before the request, on every socket, for a further sample of events.
  const arrivals = [];
  const trackers = sockets.filter(Boolean);
  for (let i = 0; i < Math.min(50, EVENTS); i += 1) {
    const entry = 9000 + i * 7;
    const t0 = performance.now();
    const pending = trackers.map(
      (ws) =>
        new Promise((res) => {
          const onMessage = (raw) => {
            const message = JSON.parse(raw.toString());
            if (message.type === 'event' && message.event.payload.entryLow === String(entry)) {
              ws.off('message', onMessage);
              arrivals.push(performance.now() - t0);
              res();
            }
          };
          ws.on('message', onMessage);
        }),
    );
    const res = await call('POST', '/admin/signals', {
      instrumentId: xau,
      direction: 'BUY',
      entryType: 'SINGLE',
      entryLow: String(entry),
      entryHigh: String(entry),
      targets: [String(entry + 150)],
      stopLoss: String(entry - 180),
      idempotencyKey: randomUUID(),
    });
    if (res.status !== 201) throw new Error('Publish failed');
    await Promise.race([Promise.all(pending), sleep(10_000)]);
    await sleep(GAP_MS);
  }
  results.liveDeliveryLatencyMs = {
    ...summary(arrivals),
    sloTargetP95: 2000,
    measuredFrom: 'just before the publish request, until the client read the event',
    perEvent: `${trackers.length} sockets x up to 50 events`,
  };
  results.connections.apiMemoryMbAfterEvents = rss();

  // ---------- Reads ----------
  const timed = async (label, count, fn) => {
    const times = [];
    for (let i = 0; i < count; i += 1) {
      const t0 = performance.now();
      const res = await fn();
      if (res.status !== 200) throw new Error(`${label}: ${res.status}`);
      times.push(performance.now() - t0);
    }
    results[label] = summary(times);
  };
  await timed('feedLoadMs', 200, () => call('GET', '/feed?limit=30'));
  await timed('activeTradesMs', 100, () => call('GET', '/trades/active'));
  await timed('dashboardLoadMs', 100, () => call('GET', '/admin/dashboard'));
  await timed('performanceReportMs', 50, () => call('GET', '/admin/performance'));
  await timed('subscriptionCheckedRequestMs', 200, () => call('GET', '/instruments/symbols'));
  await timed('healthBaselineNoDbMs', 200, async () => {
    const res = await fetch(`http://localhost:${API_PORT}/health/live`);
    await res.text();
    return { status: res.status };
  });
  const concurrentStart = performance.now();
  await Promise.all(Array.from({ length: 200 }, () => call('GET', '/feed?limit=30')));
  results.feedConcurrent200TotalMs = Number((performance.now() - concurrentStart).toFixed(1));

  for (const ws of sockets) ws?.close();
  await sleep(500);

  // ---------- Push throughput ----------
  const rows = tokens.slice(0, DEVICES).map((t, i) => {
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    return {
      id: randomUUID(),
      userId: t.id,
      sessionId: t.sessionId,
      endpoint: `https://localhost:${PUSH_PORT}/d/${i}`,
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    };
  });
  await sql.query(
    `INSERT INTO push_subscriptions (id, user_id, session_id, endpoint, p256dh, auth)
    SELECT r.id, r."userId", r."sessionId", r.endpoint, r.p256dh, r.auth FROM jsonb_to_recordset($1::jsonb) AS r(id uuid, "userId" uuid, "sessionId" uuid, endpoint text, p256dh text, auth text)`,
    [JSON.stringify(rows)],
  );
  pushesReceived = 0;
  const pushT0 = performance.now();
  const entry = 20000;
  const pushed = await call('POST', '/admin/signals', {
    instrumentId: xau,
    direction: 'BUY',
    entryType: 'SINGLE',
    entryLow: String(entry),
    entryHigh: String(entry),
    targets: [String(entry + 150)],
    stopLoss: String(entry - 180),
    idempotencyKey: randomUUID(),
  });
  if (pushed.status !== 201) throw new Error('Push publish failed');
  const deadline = Date.now() + 180_000;
  while (pushesReceived < DEVICES && Date.now() < deadline) await sleep(100);
  const pushSeconds = (lastPushAt - pushT0) / 1000;
  results.pushThroughput = {
    devices: DEVICES,
    accepted: pushesReceived,
    secondsToLastAccept: Number(pushSeconds.toFixed(2)),
    perSecond: Number((pushesReceived / pushSeconds).toFixed(0)),
    note: 'Real encryption and signing, against a local HTTPS endpoint with no network latency.',
  };

  await sql.end();
  pushServer.closeAllConnections();
  pushServer.close();
  mkdirSync(resolve(root, 'test-results'), { recursive: true });
  writeFileSync(resolve(root, 'test-results/perf.json'), `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  for (const child of children) child.kill('SIGTERM');
  await sleep(500);
  await db.stop().catch(() => undefined);
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(certDir, { recursive: true, force: true });
  process.exit(exitCode);
}
