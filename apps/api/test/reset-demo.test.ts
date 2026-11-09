import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ctx } from './helpers.js';

/* The demonstration-data reset, on a database of its own so the shared test data is never touched. */

const apiDir = resolve(import.meta.dirname, '..');
const NAME = 'signaldesk_reset_test';
let url = '';

function scriptEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: url,
    APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    PUBLIC_PERFORMANCE_ENABLED: 'false',
    ...extra,
  };
}

function run(args: string[], extra: Record<string, string> = {}) {
  const result = spawnSync('node', ['dist/scripts/reset-demo-data.js', ...args], {
    cwd: apiDir,
    env: scriptEnv(extra),
    encoding: 'utf8',
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

async function db<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const count = (table: string) =>
  db(async (c) => Number((await c.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n));

beforeAll(async () => {
  url = ctx().databaseUrl.replace(/\/[^/]+$/, `/${NAME}`);
  const admin = new pg.Client({ connectionString: ctx().databaseUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${NAME}`);
  await admin.end();
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: apiDir, env: scriptEnv(), stdio: 'pipe' });
  execFileSync('node', ['dist/scripts/seed.js'], { cwd: apiDir, env: scriptEnv(), stdio: 'pipe' });

  // A small but complete demonstration record: a closed trade with its events, an exit, an execution, an
  // announcement, an archive mark, a hidden item, a read mark, plus an account and an audit entry to keep.
  await db(async (c) => {
    const user = (
      await c.query(
        `INSERT INTO users (id, role, name, login_id, password_hash, updated_at)
         VALUES (gen_random_uuid(), 'ADMIN', 'Reset Admin', 'reset.admin', 'not-a-hash', now()) RETURNING id`,
      )
    ).rows[0].id as string;
    const instrument = (await c.query('SELECT id FROM instruments ORDER BY sort_order LIMIT 1')).rows[0].id as string;
    const trade = (
      await c.query(
        `INSERT INTO trades (id, ref, status, instrument_id, instrument_spec, direction, entry_type, entry_low,
           entry_high, original_stop_loss, stop_loss, targets, version, published_at, closed_at, created_by_id, updated_at)
         VALUES (gen_random_uuid(), 'T-9001', 'CLOSED', $1, '{"symbol": "DEMO"}', 'BUY', 'SINGLE', 100, 100, 90, 90,
           '[{"index": 1, "price": "110", "originalPrice": "110", "status": "OPEN", "hitAt": null}]', 3, now(), now(), $2, now())
         RETURNING id`,
        [instrument, user],
      )
    ).rows[0].id as string;
    const event = async (type: string, tradeId: string | null, version: number | null) =>
      (
        await c.query(
          `INSERT INTO signal_events (id, trade_id, trade_version, type, tone, title, body, payload, actor_id)
           VALUES (gen_random_uuid(), $1, $2, $3, 'NEUTRAL', 'Demo', 'Demo', '{}', $4) RETURNING id`,
          [tradeId, version, type, user],
        )
      ).rows[0].id as string;
    const published = await event('SIGNAL_PUBLISHED', trade, 1);
    const closedEvent = await event('TRADE_CLOSED', trade, 3);
    const announced = await event('ANNOUNCEMENT', null, null);
    await c.query(
      `INSERT INTO trade_execution_records (id, trade_id, event_id, basis, entry_price, recorded_by_id)
       VALUES (gen_random_uuid(), $1, $2, 'ADMIN_DECLARED_EXECUTION', 100, $3)`,
      [trade, published, user],
    );
    await c.query(
      `INSERT INTO trade_closures (id, trade_id, event_id, kind, fraction, exit_price, exited_at, basis, methodology_version)
       VALUES (gen_random_uuid(), $1, $2, 'FINAL', 1, 90, now(), 'HYPOTHETICAL_OUTCOME', 'pnl-v1')`,
      [trade, closedEvent],
    );
    await c.query(
      `INSERT INTO announcements (id, title, body, status, event_id) VALUES (gen_random_uuid(), 'Demo', 'Demo', 'PUBLISHED', $1)`,
      [announced],
    );
    await c.query('INSERT INTO trade_archives (trade_id, archived_by_id) VALUES ($1, $2)', [trade, user]);
    await c.query(`INSERT INTO user_hidden_items (user_id, item_type, item_id) VALUES ($1, 'TRADE', $2)`, [
      user,
      trade,
    ]);
    await c.query('INSERT INTO notification_reads (user_id, event_id) VALUES ($1, $2)', [user, published]);
    await c.query(`INSERT INTO audit_logs (action, target_type, target_id) VALUES ('DEMO_ENTRY', 'trade', $1)`, [
      trade,
    ]);
  });
}, 60_000);

afterAll(async () => {
  const admin = new pg.Client({ connectionString: ctx().databaseUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
  await admin.end();
});

describe('demonstration data reset', () => {
  it('is a dry run unless the exact confirmation is given', async () => {
    const dry = run([]);
    expect(dry.status).toBe(0);
    expect(dry.out).toMatch(/Dry run: nothing changed/);
    expect(dry.out).toMatch(/signal_events\s+3/);
    const wrong = run(['--confirm', 'RESET something-else']);
    expect(wrong.status).toBe(1);
    expect(await count('trades')).toBe(1);
  });

  it('refuses in production, and while public results are published', async () => {
    const prod = run(['--confirm', `RESET ${NAME}`], { NODE_ENV: 'production', APP_ORIGINS: 'https://app.test' });
    expect(prod.status).toBe(1);
    expect(prod.out).toMatch(/production/);

    await db((c) =>
      c.query(
        `INSERT INTO public_performance_approvals (id, jurisdiction, scope, reviewer_name, document_reference,
           effective_from, expires_at, created_by_id)
         SELECT gen_random_uuid(), 'Test', 'Test', 'Test', 'TEST', now() - interval '1 hour', now() + interval '1 hour', id
         FROM users WHERE login_id = 'reset.admin'`,
      ),
    );
    const published = run(['--confirm', `RESET ${NAME}`], { PUBLIC_PERFORMANCE_ENABLED: 'true' });
    expect(published.status).toBe(1);
    expect(published.out).toMatch(/Public results are being published/);
    expect(await count('trades')).toBe(1);
  });

  it('clears the record, keeps accounts and the audit log, snapshots everything, and restores the guards', async () => {
    const done = run(['--confirm', `RESET ${NAME}`]);
    expect(done.status, done.out).toBe(0);
    for (const table of ['trades', 'signal_events', 'trade_closures', 'trade_execution_records', 'announcements']) {
      expect(await count(table)).toBe(0);
    }
    expect(await count('users')).toBe(1);
    expect(await count('instruments')).toBeGreaterThan(0);

    await db(async (c) => {
      const actions = (await c.query('SELECT action, metadata FROM audit_logs ORDER BY id')).rows;
      expect(actions.map((a: { action: string }) => a.action)).toEqual(['DEMO_ENTRY', 'DEMO_DATA_RESET']);
      const snapshot = actions[1].metadata.snapshotSchema as string;
      expect(actions[1].metadata.cleared.signal_events).toBe(3);
      expect(Number((await c.query(`SELECT count(*) AS n FROM ${snapshot}.signal_events`)).rows[0].n)).toBe(3);
      expect(Number((await c.query(`SELECT count(*) AS n FROM ${snapshot}.trades`)).rows[0].n)).toBe(1);
      expect(
        (await c.query('SELECT data_reset_at FROM app_settings WHERE id = 1')).rows[0].data_reset_at,
      ).not.toBeNull();

      // New events start a clean chain, and append-only is enforced again.
      const id = (
        await c.query(
          `INSERT INTO signal_events (id, type, tone, title, body, payload) VALUES (gen_random_uuid(), 'ANNOUNCEMENT', 'NEUTRAL', 'New', 'New', '{}') RETURNING id, seq`,
        )
      ).rows[0];
      expect(Number(id.seq)).toBeGreaterThan(3);
      expect((await c.query('SELECT first_bad_seq FROM verify_signal_event_chain()')).rows[0].first_bad_seq).toBeNull();
      await expect(c.query('DELETE FROM signal_events WHERE id = $1', [id.id])).rejects.toThrow(/append-only/);
    });
  });
});
