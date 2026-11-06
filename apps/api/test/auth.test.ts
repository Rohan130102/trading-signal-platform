import { generate } from 'otplib';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { admin, Client, ctx, newSubscriber, PASSWORD, uniqueId, withDb } from './helpers.js';

describe('sign-in', () => {
  it('gives the same answer for an unknown login and a wrong password', async () => {
    const { loginId } = await newSubscriber(30);
    const client = new Client();
    const wrong = await client.post('/auth/login', { identifier: loginId, password: 'not-the-password' });
    const unknown = await client.post('/auth/login', { identifier: uniqueId('ghost'), password: 'not-the-password' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.code).toBe(unknown.body.error.code);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('sets a session cookie JavaScript cannot read, and it holds only an opaque token', async () => {
    const { loginId } = await newSubscriber(30);
    const res = await new Client().post('/auth/login', { identifier: loginId, password: PASSWORD });
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(res.status).toBe(200);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
  });

  it('stores a hash of the session token, never the token', async () => {
    const { client } = await newSubscriber(30);
    const token = (client.cookie as string).split('=')[1] as string;
    const rows = await withDb((db) =>
      db.query('SELECT count(*)::int AS n FROM sessions WHERE token_hash = $1', [token]),
    );
    expect(rows.rows[0].n).toBe(0);
  });

  it('never stores a plaintext password', async () => {
    const { loginId, temporaryPassword } = await newSubscriber(30);
    const rows = await withDb((db) => db.query('SELECT password_hash FROM users WHERE login_id = $1', [loginId]));
    expect(rows.rows[0].password_hash).toMatch(/^\$argon2id\$/);
    expect(rows.rows[0].password_hash).not.toContain(temporaryPassword);
  });

  it('throttles repeated failures for one login, without revealing whether it exists', async () => {
    const real = await newSubscriber(30);
    const ghost = uniqueId('ghost');
    for (const identifier of [real.loginId, ghost]) {
      const client = new Client();
      let last = 0;
      for (let i = 0; i < 9; i += 1) {
        last = (await client.post('/auth/login', { identifier, password: 'wrong-password-1' })).status;
      }
      expect(last).toBe(429);
    }
    const blocked = await new Client().post('/auth/login', { identifier: real.loginId, password: PASSWORD });
    expect(blocked.status).toBe(429);
    await withDb((db) => db.query("DELETE FROM rate_limit_buckets WHERE key LIKE 'login:%'"));
  });

  it('rejects malformed and oversized input safely', async () => {
    const client = new Client();
    expect((await client.post('/auth/login', { identifier: '', password: '' })).status).toBe(422);
    expect((await client.post('/auth/login', { identifier: 'a', password: 'b', extra: 1 })).status).toBe(422);
    const huge = await client.post('/auth/login', { identifier: 'a', password: 'x'.repeat(100_000) });
    expect(huge.status).toBe(413);
    const injected = await client.post('/auth/login', { identifier: "' OR 1=1 --", password: "' OR 1=1 --" });
    expect(injected.status).toBe(401);
  });
});

describe('malformed requests', () => {
  it('a broken JSON body is a clean 400', async () => {
    const res = await fetch(`${ctx().api}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ctx().origin },
      body: '{"identifier":',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).not.toMatch(/JSON|position|token/i);
  });

  it('an impossible date is rejected, not a server error', async () => {
    const { client } = await newSubscriber(30);
    const res = await client.get('/trades/history?from=2026-13-45');
    expect(res.status).toBe(422);
    const leap = await client.get('/trades/history?from=2026-02-30');
    expect(leap.status).toBe(422);
  });
});

describe('cross-site protection', () => {
  it('refuses state-changing requests from another origin or none at all', async () => {
    const { client } = await newSubscriber(30);
    const foreign = await client.req('POST', '/auth/logout', {}, { origin: 'https://evil.example' });
    expect(foreign.status).toBe(403);
    expect(foreign.body.error.code).toBe('BAD_ORIGIN');
    const res = await fetch(`${ctx().api}/auth/logout`, {
      method: 'POST',
      headers: { cookie: client.cookie as string },
    });
    expect(res.status).toBe(403);
    expect((await client.get('/auth/me')).status).toBe(200);
  });
});

describe('first sign-in', () => {
  it('a temporary password can only be used to set a new one', async () => {
    const created = await newSubscriber(30, { complete: false });
    const { client, loginId, temporaryPassword } = created;
    await client.post('/auth/login', { identifier: loginId, password: temporaryPassword });
    const me = await client.get('/auth/me');
    expect(me.body.next).toBe('CHANGE_PASSWORD');
    const feed = await client.get('/feed');
    expect(feed.status).toBe(403);
    expect(feed.body.error.code).toBe('SESSION_STEP_REQUIRED');
    const changed = await client.post('/auth/change-password', {
      currentPassword: temporaryPassword,
      newPassword: PASSWORD,
    });
    expect(changed.status).toBe(200);
    expect((await client.get('/feed')).status).toBe(200);
    const again = await new Client().post('/auth/login', { identifier: loginId, password: temporaryPassword });
    expect(again.status).toBe(401);
  });

  it('rejects a temporary password after it expires', async () => {
    const { loginId, temporaryPassword } = await newSubscriber(30, { complete: false });
    await withDb((db) =>
      db.query("UPDATE users SET temp_password_expires_at = now() - interval '1 minute' WHERE login_id = $1", [
        loginId,
      ]),
    );
    const res = await new Client().post('/auth/login', { identifier: loginId, password: temporaryPassword });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TEMP_PASSWORD_EXPIRED');
  });

  it('rejects weak or unchanged new passwords', async () => {
    const { client, loginId, temporaryPassword } = await newSubscriber(30, { complete: false });
    await client.post('/auth/login', { identifier: loginId, password: temporaryPassword });
    const short = await client.post('/auth/change-password', {
      currentPassword: temporaryPassword,
      newPassword: 'short',
    });
    expect(short.status).toBe(422);
    const common = await client.post('/auth/change-password', {
      currentPassword: temporaryPassword,
      newPassword: 'password123',
    });
    expect(common.body.error.code).toBe('WEAK_PASSWORD');
    const containsId = await client.post('/auth/change-password', {
      currentPassword: temporaryPassword,
      newPassword: `${loginId}-2026`,
    });
    expect(containsId.body.error.code).toBe('WEAK_PASSWORD');
    const same = await client.post('/auth/change-password', {
      currentPassword: temporaryPassword,
      newPassword: temporaryPassword,
    });
    expect(same.body.error.code).toBe('WEAK_PASSWORD');
    const wrong = await client.post('/auth/change-password', {
      currentPassword: 'wrong-current',
      newPassword: PASSWORD,
    });
    expect(wrong.body.error.code).toBe('INVALID_CURRENT_PASSWORD');
  });
});

describe('sessions', () => {
  it('logout ends the session immediately', async () => {
    const { client } = await newSubscriber(30);
    const cookie = client.cookie;
    await client.post('/auth/logout');
    const stale = new Client(cookie);
    expect((await stale.get('/feed')).status).toBe(401);
  });

  it('logout everywhere ends every session', async () => {
    const { client, loginId } = await newSubscriber(30);
    const other = new Client();
    await other.post('/auth/login', { identifier: loginId, password: PASSWORD });
    expect((await other.get('/feed')).status).toBe(200);
    await client.post('/auth/logout-all');
    expect((await other.get('/feed')).status).toBe(401);
    expect((await new Client(client.cookie).get('/feed')).status).toBe(401);
  });

  it('a password change signs out other devices but keeps this one', async () => {
    const { client, loginId } = await newSubscriber(30);
    const other = new Client();
    await other.post('/auth/login', { identifier: loginId, password: PASSWORD });
    const changed = await client.post('/auth/change-password', {
      currentPassword: PASSWORD,
      newPassword: 'a-new-long-passphrase',
    });
    expect(changed.status).toBe(200);
    expect((await client.get('/feed')).status).toBe(200);
    expect((await other.get('/feed')).status).toBe(401);
  });

  it('an admin password reset ends sessions and issues a working temporary password', async () => {
    const { client, id, loginId } = await newSubscriber(30);
    const reset = await admin().post(`/admin/subscribers/${id}/reset-password`);
    expect(reset.status).toBe(200);
    expect((await client.get('/feed')).status).toBe(401);
    const fresh = new Client();
    expect((await fresh.post('/auth/login', { identifier: loginId, password: PASSWORD })).status).toBe(401);
    expect(
      (await fresh.post('/auth/login', { identifier: loginId, password: reset.body.temporaryPassword })).status,
    ).toBe(200);
    expect((await fresh.get('/auth/me')).body.next).toBe('CHANGE_PASSWORD');
  });

  it('admin sessions end after going idle', async () => {
    const { login, cookie } = await newAdminWithMfa();
    await withDb((db) =>
      db.query(
        "UPDATE sessions SET last_seen_at = now() - interval '3 hours' WHERE user_id = (SELECT id FROM users WHERE login_id = $1)",
        [login],
      ),
    );
    expect((await new Client(cookie).get('/admin/dashboard')).status).toBe(401);
  });
});

const apiDir = resolve(import.meta.dirname, '..');

function provisionAdmin(): { login: string; temp: string } {
  const login = uniqueId('admin');
  const output = execFileSync('node', ['dist/scripts/create-admin.js', login, 'Second Admin'], {
    cwd: apiDir,
    env: {
      ...process.env,
      DATABASE_URL: ctx().databaseUrl,
      NODE_ENV: 'test',
      APP_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
    },
    encoding: 'utf8',
  });
  return { login, temp: /valid 24 hours\): (\S+)/.exec(output)?.[1] as string };
}

async function newAdminWithMfa() {
  const { login, temp } = provisionAdmin();
  const client = new Client();
  await client.post('/auth/login', { identifier: login, password: temp });
  await client.post('/auth/change-password', { currentPassword: temp, newPassword: PASSWORD });
  const setup = await client.post('/auth/mfa/setup');
  const code = await generate({ secret: setup.body.secret });
  const enable = await client.post('/auth/mfa/enable', { code });
  return {
    login,
    client,
    cookie: client.cookie as string,
    secret: setup.body.secret as string,
    code,
    recoveryCodes: enable.body.recoveryCodes as string[],
  };
}

describe('administrator MFA', () => {
  it('an administrator cannot reach anything before setting it up', async () => {
    const { login, temp } = provisionAdmin();
    const client = new Client();
    await client.post('/auth/login', { identifier: login, password: temp });
    expect((await client.get('/auth/me')).body.next).toBe('CHANGE_PASSWORD');
    await client.post('/auth/change-password', { currentPassword: temp, newPassword: PASSWORD });
    expect((await client.get('/auth/me')).body.next).toBe('MFA_SETUP');
    const blocked = await client.get('/admin/dashboard');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('SESSION_STEP_REQUIRED');
    const setup = await client.post('/auth/mfa/setup');
    expect(setup.body.qrSvg).toContain('<svg');
    const wrong = await client.post('/auth/mfa/enable', { code: '000000' });
    expect(wrong.status).toBe(422);
    const enable = await client.post('/auth/mfa/enable', { code: await generate({ secret: setup.body.secret }) });
    expect(enable.body.recoveryCodes).toHaveLength(8);
    expect((await client.get('/admin/dashboard')).status).toBe(200);
  });

  it('stores the MFA secret encrypted', async () => {
    const { login, secret } = await newAdminWithMfa();
    const row = await withDb((db) => db.query('SELECT mfa_secret_enc FROM users WHERE login_id = $1', [login]));
    expect(row.rows[0].mfa_secret_enc).not.toContain(secret);
  });

  it('a later sign-in requires a code, and a code cannot be replayed', async () => {
    const { login, secret, code } = await newAdminWithMfa();
    const client = new Client();
    await client.post('/auth/login', { identifier: login, password: PASSWORD });
    expect((await client.get('/auth/me')).body.next).toBe('MFA_VERIFY');
    expect((await client.get('/admin/dashboard')).status).toBe(403);
    const replay = await client.post('/auth/mfa/verify', { code });
    expect(replay.status).toBe(422);
    expect(replay.body.error.code).toBe('INVALID_CODE');
    expect(secret).toBeTruthy();
  });

  it('a recovery code works exactly once', async () => {
    const { login, recoveryCodes } = await newAdminWithMfa();
    const recovery = recoveryCodes[0] as string;
    const first = new Client();
    await first.post('/auth/login', { identifier: login, password: PASSWORD });
    expect((await first.post('/auth/mfa/verify', { code: recovery })).status).toBe(200);
    expect((await first.get('/admin/dashboard')).status).toBe(200);
    const second = new Client();
    await second.post('/auth/login', { identifier: login, password: PASSWORD });
    expect((await second.post('/auth/mfa/verify', { code: recovery })).status).toBe(422);
  });

  it('limits guesses', async () => {
    const { login } = await newAdminWithMfa();
    const client = new Client();
    await client.post('/auth/login', { identifier: login, password: PASSWORD });
    let last = 0;
    for (let i = 0; i < 7; i += 1) last = (await client.post('/auth/mfa/verify', { code: '123456' })).status;
    expect(last).toBe(429);
  });

  it('a subscriber does not need MFA', async () => {
    const { client } = await newSubscriber(30);
    expect((await client.get('/auth/me')).body.next).toBeNull();
    expect(randomUUID()).toBeTruthy();
  });
});

describe('response hygiene', () => {
  it('sends security headers and forbids caching private responses', async () => {
    const { client } = await newSubscriber(30);
    const res = await client.get('/feed');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-powered-by')).toBeNull();
    expect(res.headers.get('content-security-policy')).toBeTruthy();
  });

  it('error responses do not expose internals', async () => {
    const res = await new Client().get('/definitely/not/a/route');
    expect(JSON.stringify(res.body)).not.toMatch(/stack|prisma|at .*\.js/i);
  });

  it('never returns password hashes or MFA secrets through admin APIs', async () => {
    const { id } = await newSubscriber(30);
    const detail = await admin().get(`/admin/subscribers/${id}`);
    const wire = JSON.stringify(detail.body);
    expect(wire).not.toMatch(/passwordHash|password_hash|argon2|mfaSecret|tokenHash/);
  });

  it('records credential events in the audit log without credentials in them', async () => {
    const { id, temporaryPassword } = await newSubscriber(30);
    const log = await admin().get(`/admin/audit?targetId=${id}`);
    const wire = JSON.stringify(log.body);
    expect(log.body.entries.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining(['SUBSCRIBER_CREATED', 'PASSWORD_CHANGED']),
    );
    expect(wire).not.toContain(temporaryPassword);
    expect(wire).not.toContain(PASSWORD);
  });
});
