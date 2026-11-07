import { createDecipheriv, createECDH, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  admin,
  act,
  control,
  ctx,
  drained,
  newSubscriber,
  publish,
  signalBody,
  waitUntil,
  withDb,
  type Client,
} from './helpers.js';

interface Device {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  ecdh: ReturnType<typeof createECDH>;
  authSecret: Buffer;
}

function newDevice(kind: 'ok' | 'gone' | 'flaky' | 'reject' = 'ok'): Device {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const authSecret = randomBytes(16);
  return {
    endpoint: `${ctx().pushBase}/${kind}/${randomUUID()}`,
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') },
    ecdh,
    authSecret,
  };
}

/** RFC 8291 decryption, proving the library really encrypted for this device. */
function decrypt(
  device: Device,
  base64: string,
): { title: string; body: string; url: string; tag: string; urgent: boolean } {
  const data = Buffer.from(base64, 'base64');
  const salt = data.subarray(0, 16);
  const idLength = data[20] as number;
  const serverPublic = data.subarray(21, 21 + idLength);
  const record = data.subarray(21 + idLength);
  const shared = device.ecdh.computeSecret(serverPublic);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), device.ecdh.getPublicKey(), serverPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, device.authSecret, info, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const plain = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()]);
  const end = plain.lastIndexOf(2);
  return JSON.parse(plain.subarray(0, end).toString('utf8'));
}

async function register(client: Client, device: Device) {
  const res = await client.post('/push/subscriptions', {
    endpoint: device.endpoint,
    keys: device.keys,
    deviceLabel: 'Test phone',
  });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
}

interface PushLogEntry {
  path: string;
  headers: Record<string, string>;
  body: string;
  status: number;
}

async function pushesTo(device: Device): Promise<PushLogEntry[]> {
  const log = (await control('/push-log')) as PushLogEntry[];
  const path = new URL(device.endpoint).pathname;
  return log.filter((entry) => entry.path === path);
}

const deliveries = (eventId: string, device?: Device) =>
  withDb(
    async (db) =>
      (
        await db.query(
          `SELECT d.status, d.attempts, d.last_status_code, d.next_attempt_at, d.updated_at
           FROM push_deliveries d JOIN push_subscriptions s ON s.id = d.push_subscription_id
           WHERE d.event_id = $1 AND ($2::text IS NULL OR s.endpoint = $2)`,
          [eventId, device?.endpoint ?? null],
        )
      ).rows,
  );

async function waitForPush(device: Device, count = 1) {
  return waitUntil(
    async () => {
      const pushes = await pushesTo(device);
      return pushes.length >= count ? pushes : false;
    },
    15_000,
    'push',
  );
}

describe('web push', () => {
  beforeAll(async () => {
    await control('/worker/start');
  });

  it('exposes only the public key', async () => {
    const { client } = await newSubscriber(30);
    const config = await client.get('/push/config');
    expect(config.body.available).toBe(true);
    expect(config.body.publicKey).toBeTruthy();
    expect(JSON.stringify(config.body)).not.toMatch(/private/i);
  });

  it('sends an encrypted, signed push the device can read, with a sane lifetime', async () => {
    const { client } = await newSubscriber(30);
    const device = newDevice();
    await register(client, device);
    const trade = await publish({ entry: 3300, confirmDuplicate: true });
    const [push] = await waitForPush(device);
    expect(push?.headers['content-encoding']).toBe('aes128gcm');
    expect(push?.headers.authorization).toMatch(/^vapid t=.+, k=.+/);
    expect(push?.headers.ttl).toBe('3600');
    expect(push?.headers.urgency).toBe('high');
    const message = decrypt(device, push?.body as string);
    expect(message.title).toBe('New signal: BUY XAU/USD');
    expect(message.body).toContain('Stop-loss: 3,120.00');
    expect(message.url).toBe(`/app/trades/${trade.id}`);
  });

  it('records the transport result and never calls it delivered', async () => {
    const { client } = await newSubscriber(30);
    const device = newDevice();
    await register(client, device);
    const trade = await publish();
    await waitForPush(device);
    const eventId = trade.events[0].id;
    const rows = await waitUntil(async () => {
      const r = await deliveries(eventId, device);
      return r.some((x) => x.status === 'ACCEPTED') ? r : false;
    });
    expect(rows.find((r) => r.status === 'ACCEPTED')?.last_status_code).toBe(201);
    const detail = await waitUntil(async () => {
      const d = await admin().get(`/admin/trades/${trade.id}`);
      return d.body.events[0].dispatch.accepted >= 1 ? d : false;
    });
    expect(Object.keys(detail.body.events[0].dispatch)).not.toContain('delivered');
  });

  it('hides content when the subscriber asked for no previews', async () => {
    const { client } = await newSubscriber(30);
    const device = newDevice();
    await register(client, device);
    const saved = await client.req('PUT', '/me/notification-preferences', {
      pushNewSignals: true,
      pushUpdates: true,
      pushClosures: true,
      pushAnnouncements: true,
      hidePreview: true,
    });
    expect(saved.body.hidePreview).toBe(true);
    await publish({ entry: 3305, confirmDuplicate: true });
    const [push] = await waitForPush(device);
    const message = decrypt(device, push?.body as string);
    expect(message.title).toBe('New update');
    expect(message.body).toBe('Open the app to read it.');
    expect(JSON.stringify(message)).not.toMatch(/XAU|3,305|BUY|Stop-loss/);
  });

  it('honours per-category preferences', async () => {
    const { client } = await newSubscriber(30);
    const device = newDevice();
    await register(client, device);
    await client.req('PUT', '/me/notification-preferences', {
      pushNewSignals: false,
      pushUpdates: true,
      pushClosures: true,
      pushAnnouncements: true,
      hidePreview: false,
    });
    const trade = await publish();
    await act(trade, 'CANCEL', { comment: 'x' });
    const pushes = await waitForPush(device);
    expect(pushes).toHaveLength(1);
    expect(decrypt(device, pushes[0]?.body as string).title).toContain('Cancelled');
  });

  it('removes a device the push service reports as gone', async () => {
    const { client } = await newSubscriber(30);
    const device = newDevice('gone');
    await register(client, device);
    await publish();
    await waitForPush(device);
    await waitUntil(async () => (await client.get('/push/devices')).body.devices.length === 0, 8000, 'device removal');
    await publish();
    await new Promise((r) => setTimeout(r, 600));
    expect(await pushesTo(device)).toHaveLength(1);
  });

  it('retries a temporary failure with backoff, then succeeds', async () => {
    await drained();
    const { client } = await newSubscriber(30);
    const device = newDevice('flaky');
    await register(client, device);
    const started = Date.now();
    const trade = await publish();
    const pushes = await waitForPush(device, 3);
    expect(pushes.map((p) => p.status)).toEqual([503, 503, 201]);
    // Backoff of 2s then 4s, so this cannot have been a tight loop.
    expect(Date.now() - started).toBeGreaterThan(5000);
    const row = await waitUntil(async () => {
      const r = await deliveries(trade.events[0].id, device);
      return r.find((x) => x.status === 'ACCEPTED') ?? false;
    });
    expect(row.attempts).toBe(3);
  }, 30_000);

  it('does not retry a permanent rejection, and surfaces it to administrators', async () => {
    const { client } = await newSubscriber(30);
    const device = newDevice('reject');
    await register(client, device);
    const trade = await publish();
    await waitForPush(device);
    const row = await waitUntil(async () => {
      const r = await deliveries(trade.events[0].id);
      return r.find((x) => x.status === 'FAILED') ?? false;
    });
    expect(row.attempts).toBe(1);
    const health = await admin().get('/admin/notifications/health');
    expect(health.body.recentFailures.length).toBeGreaterThan(0);
    const detail = await admin().get(`/admin/trades/${trade.id}`);
    expect(detail.body.events[0].dispatch.failed).toBeGreaterThanOrEqual(1);
  });

  it('never sends to an expired subscriber', async () => {
    const { client, id } = await newSubscriber(30);
    const device = newDevice();
    await register(client, device);
    await admin().post(`/admin/subscribers/${id}/adjust`, {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      activationDate: '2026-01-01',
      note: 'expired',
      idempotencyKey: randomUUID(),
    });
    await publish();
    await new Promise((r) => setTimeout(r, 800));
    expect(await pushesTo(device)).toHaveLength(0);
  });

  it('re-checks access at send time, so a queued push is dropped if access ended meanwhile', async () => {
    const { client, id } = await newSubscriber(30);
    const device = newDevice();
    await register(client, device);
    await control('/worker/kill');
    const trade = await publish();
    // Simulates a job already queued for this device before access ended.
    await withDb(async (db) => {
      const sub = await db.query('SELECT id FROM push_subscriptions WHERE endpoint = $1', [device.endpoint]);
      await db.query(
        "INSERT INTO push_deliveries (id, event_id, push_subscription_id, user_id, status, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, 'PENDING', now())",
        [trade.events[0].id, sub.rows[0].id, id],
      );
    });
    await admin().post(`/admin/subscribers/${id}/adjust`, {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      activationDate: '2026-01-01',
      note: 'expired while queued',
      idempotencyKey: randomUUID(),
    });
    await control('/worker/start');
    const row = await waitUntil(
      async () => {
        const r = await deliveries(trade.events[0].id);
        return r.find((x) => x.status === 'SKIPPED') ?? false;
      },
      15_000,
      'skip',
    );
    expect(row).toBeTruthy();
    expect(await pushesTo(device)).toHaveLength(0);
  });

  it('stops pushing to a device whose session ended', async () => {
    const { client } = await newSubscriber(30);
    const device = newDevice();
    await register(client, device);
    await client.post('/auth/logout');
    await publish();
    await new Promise((r) => setTimeout(r, 800));
    expect(await pushesTo(device)).toHaveLength(0);
  });

  it('a re-registered endpoint moves to the person now using that browser', async () => {
    const first = await newSubscriber(30);
    const second = await newSubscriber(30);
    const device = newDevice();
    await register(first.client, device);
    await register(second.client, device);
    expect((await first.client.get('/push/devices')).body.devices).toHaveLength(0);
    expect((await second.client.get('/push/devices')).body.devices).toHaveLength(1);
  });

  it('refuses a push endpoint on a host outside the allow-list', async () => {
    const { client } = await newSubscriber(30);
    const device = newDevice();
    for (const endpoint of [
      'https://169.254.169.254/latest/meta-data',
      'https://internal.example/x',
      'http://localhost:9/x',
    ]) {
      const res = await client.post('/push/subscriptions', { endpoint, keys: device.keys });
      expect(res.status).toBe(422);
    }
  });

  it('the test notification carries no signal content and goes only to the caller', async () => {
    const a = await newSubscriber(30);
    const b = await newSubscriber(30);
    const da = newDevice();
    const db = newDevice();
    await register(a.client, da);
    await register(b.client, db);
    const res = await a.client.post('/push/test');
    expect(res.body).toMatchObject({ attempted: 1, accepted: 1 });
    expect(res.body.note).toMatch(/push service/i);
    const [push] = await waitForPush(da);
    expect(decrypt(da, push?.body as string).title).toBe('Test notification');
    expect(await pushesTo(db)).toHaveLength(0);
  });
});

describe('worker reliability', () => {
  it('survives a crash: events published while it is down are delivered on restart', async () => {
    const { client } = await newSubscriber(30);
    const device = newDevice();
    await register(client, device);
    await control('/worker/kill');
    const trade = await publish();
    await new Promise((r) => setTimeout(r, 600));
    expect(await pushesTo(device)).toHaveLength(0);
    // In-app delivery does not depend on the worker.
    const feed = await client.get('/feed?limit=1');
    expect(feed.body.events[0].tradeId).toBe(trade.id);
    await control('/worker/start');
    const [push] = await waitForPush(device);
    expect(decrypt(device, push?.body as string).url).toContain(trade.id);
  });

  it('reports a stopped worker to administrators', async () => {
    await control('/worker/kill');
    const unhealthy = await waitUntil(
      async () => {
        const h = await admin().get('/admin/notifications/health');
        return h.body.worker.healthy === false ? h : false;
      },
      30_000,
      'unhealthy report',
    );
    expect(unhealthy.body.status).toBe('ATTENTION');
    const dashboard = await admin().get('/admin/dashboard');
    expect(dashboard.body.alerts.some((a: { level: string }) => a.level === 'CRITICAL')).toBe(true);
    await control('/worker/start');
    await waitUntil(
      async () => (await admin().get('/admin/notifications/health')).body.worker.healthy,
      15_000,
      'recovery',
    );
  }, 60_000);

  it('processing the same job twice does not send twice', async () => {
    await drained();
    const { client } = await newSubscriber(30);
    const device = newDevice();
    await register(client, device);
    const trade = await publish();
    await waitForPush(device);
    await drained();
    const before = (await deliveries(trade.events[0].id)).length;
    await withDb((db) =>
      db.query("UPDATE outbox_events SET status = 'PENDING', available_at = now() WHERE event_id = $1", [
        trade.events[0].id,
      ]),
    );
    await waitUntil(async () => {
      const row = await withDb((db) =>
        db.query('SELECT status FROM outbox_events WHERE event_id = $1', [trade.events[0].id]),
      );
      return row.rows[0].status === 'DONE';
    });
    await new Promise((r) => setTimeout(r, 500));
    expect(await pushesTo(device)).toHaveLength(1);
    expect(await deliveries(trade.events[0].id, device)).toHaveLength(1);
    expect(await deliveries(trade.events[0].id)).toHaveLength(before);
  });

  it('reclaims a job left locked by a crashed worker', async () => {
    const { client } = await newSubscriber(30);
    const device = newDevice();
    await register(client, device);
    await control('/worker/kill');
    const trade = await publish();
    await withDb((db) =>
      db.query(
        "UPDATE outbox_events SET status = 'PROCESSING', locked_by = 'dead-worker', locked_at = now() - interval '5 minutes' WHERE event_id = $1",
        [trade.events[0].id],
      ),
    );
    await control('/worker/start');
    await waitForPush(device);
  });

  it('a second worker running at the same time does not double-send', async () => {
    await drained();
    const { client } = await newSubscriber(30);
    const devices = [newDevice(), newDevice(), newDevice()];
    for (const device of devices) await register(client, device);
    await control('/worker/second/start');
    await new Promise((r) => setTimeout(r, 800));
    const bodies = await Promise.all(Array.from({ length: 10 }, () => signalBody()));
    await Promise.all(bodies.map((body) => admin().post('/admin/signals', body)));
    for (const device of devices) await waitForPush(device, 10);
    await drained();
    await new Promise((r) => setTimeout(r, 400));
    for (const device of devices) {
      const paths = await pushesTo(device);
      expect(paths).toHaveLength(10);
    }
    await control('/worker/second/stop');
  }, 40_000);

  it('administrators can requeue recent failures', async () => {
    const res = await admin().post('/admin/notifications/retry-failed');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('deliveries');
    const log = await admin().get('/admin/audit?action=NOTIFICATIONS_RETRIED');
    expect(log.body.total).toBeGreaterThan(0);
  });
});
