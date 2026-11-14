import { describe, expect, it } from 'vitest';
import { admin, Client, ctx, newSubscriber, PASSWORD, publish, withDb } from './helpers.js';
import { codeIn, details, latestCode, mailbox, NEW_PASSWORD, signUp, uniqueEmail } from './onboarding.js';

describe('sign-up', () => {
  it('verifies the address, creates the password and signs in with no access to signals', async () => {
    const email = uniqueEmail();
    const client = new Client();
    const started = await client.post('/auth/register', details(email.toUpperCase()));
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({ email });
    expect(Date.parse(started.body.resendAvailableAt) - Date.now()).toBeGreaterThan(50_000);

    const mail = mailbox(email).at(-1);
    expect(mail?.subject).toContain('verification code');
    expect(mail?.text).toContain('expires in 5 minutes');
    const verified = await client.post('/auth/register/verify', {
      challengeId: started.body.challengeId,
      code: codeIn(mail),
    });
    expect(verified.status).toBe(200);
    expect(verified.body.setupToken).toEqual(expect.any(String));

    const completed = await client.post('/auth/register/complete', {
      setupToken: verified.body.setupToken,
      password: NEW_PASSWORD,
    });
    expect(completed.status).toBe(200);
    const me = (await client.get('/auth/me')).body;
    expect(me).toMatchObject({
      role: 'SUBSCRIBER',
      loginId: email,
      next: null,
      access: { allowed: false, reason: 'SUBSCRIPTION_NONE' },
      subscription: { state: 'NONE', kind: null },
      enquiryStatus: 'NOT_CONTACTED',
      profile: { firstName: 'Asha', lastName: 'Rao', email, mobile: '+919876543210' },
      trialGreeting: null,
    });
    // Paid content stays closed, however it is asked for.
    const trade = await publish();
    expect((await client.get('/feed')).status).toBe(403);
    expect((await client.get(`/trades/${trade.id}`)).status).toBe(403);
    expect((await client.get('/trades/history')).status).toBe(403);
  });

  it('never grants a trial or subscription by itself', async () => {
    const { id } = await signUp();
    const rows = await withDb(async (db) => ({
      trials: (await db.query('SELECT count(*)::int AS n FROM trial_grants WHERE user_id = $1', [id])).rows[0].n,
      subs: (await db.query('SELECT count(*)::int AS n FROM subscriptions WHERE user_id = $1', [id])).rows[0].n,
    }));
    expect(rows).toEqual({ trials: 0, subs: 0 });
  });

  it('signs in with the registered email in any case, and older accounts with their login ID', async () => {
    const { email } = await signUp();
    expect(
      (await new Client().post('/auth/login', { identifier: email.toUpperCase(), password: NEW_PASSWORD })).status,
    ).toBe(200);
    const legacy = await newSubscriber(5);
    expect((await new Client().post('/auth/login', { identifier: legacy.loginId, password: PASSWORD })).status).toBe(
      200,
    );
  });

  it('refuses invalid details with a reason for each field', async () => {
    const email = uniqueEmail();
    const cases: [Record<string, unknown>, string][] = [
      [{ email: 'not-an-email' }, 'email'],
      [{ mobile: '12345' }, 'mobile'],
      [{ mobile: '+91 22 2266 1234' }, 'mobile'],
      [{ age: 17 }, 'age'],
      [{ age: 0 }, 'age'],
      [{ age: 'twenty' }, 'age'],
      [{ firstName: '' }, 'firstName'],
      [{ consent: false }, 'consent'],
    ];
    for (const [change, field] of cases) {
      const res = await new Client().post('/auth/register', details(email, change));
      expect(res.status, JSON.stringify(change)).toBe(422);
      expect(JSON.stringify(res.body.error), field).toContain(field);
    }
    expect(mailbox(email)).toHaveLength(0);
  });

  it('answers the same for a taken address, and emails its owner instead of sending a code', async () => {
    const { email } = await signUp();
    const before = mailbox(email).length;
    const again = await new Client().post('/auth/register', details(email));
    expect(again.status).toBe(200);
    expect(Object.keys(again.body).sort()).toEqual(['challengeId', 'email', 'expiresAt', 'resendAvailableAt']);
    const mail = mailbox(email).slice(before).at(-1);
    expect(mail?.subject).toContain('already have an account');
    expect(mail?.text).not.toMatch(/\b\d{6}\b/);
    const guess = await new Client().post('/auth/register/verify', {
      challengeId: again.body.challengeId,
      code: '123456',
    });
    expect(guess.status).toBe(422);
  });

  it('counts wrong codes and locks the code after five', async () => {
    const email = uniqueEmail();
    const client = new Client();
    const { challengeId } = (await client.post('/auth/register', details(email))).body;
    const code = await latestCode(email);
    const wrong = code === '000000' ? '111111' : '000000';
    const first = await client.post('/auth/register/verify', { challengeId, code: wrong });
    expect(first.status).toBe(422);
    expect(first.body.error.message).toContain('4 tries left');
    for (let i = 0; i < 4; i++) await client.post('/auth/register/verify', { challengeId, code: wrong });
    const locked = await client.post('/auth/register/verify', { challengeId, code });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('refuses an expired code', async () => {
    const email = uniqueEmail();
    const client = new Client();
    const { challengeId } = (await client.post('/auth/register', details(email))).body;
    const code = await latestCode(email);
    await withDb((db) =>
      db.query("UPDATE email_challenges SET code_expires_at = now() - interval '1 second' WHERE id = $1", [
        challengeId,
      ]),
    );
    const res = await client.post('/auth/register/verify', { challengeId, code });
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('CODE_EXPIRED');
  });

  it('waits a minute between codes, and a new code replaces the old one', async () => {
    const email = uniqueEmail();
    const client = new Client();
    const { challengeId } = (await client.post('/auth/register', details(email))).body;
    const oldCode = await latestCode(email);
    const tooSoon = await client.post('/auth/register/resend', { challengeId });
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.error.code).toBe('RESEND_TOO_SOON');
    // A repeated sign-up within the minute is the same request: same challenge, no second email.
    const repeat = await client.post('/auth/register', details(email));
    expect(repeat.body.challengeId).toBe(challengeId);
    expect(mailbox(email)).toHaveLength(1);

    await withDb((db) =>
      db.query("UPDATE email_challenges SET sent_at = now() - interval '61 seconds' WHERE id = $1", [challengeId]),
    );
    expect((await client.post('/auth/register/resend', { challengeId })).status).toBe(200);
    const newCode = await latestCode(email, 1);
    if (newCode !== oldCode) {
      expect((await client.post('/auth/register/verify', { challengeId, code: oldCode })).status).toBe(422);
    }
    expect((await client.post('/auth/register/verify', { challengeId, code: newCode })).status).toBe(200);
  });

  it('a code and a setup token each work once', async () => {
    const email = uniqueEmail();
    const client = new Client();
    const { challengeId } = (await client.post('/auth/register', details(email))).body;
    const code = await latestCode(email);
    const verified = await client.post('/auth/register/verify', { challengeId, code });
    expect(verified.status).toBe(200);
    expect((await client.post('/auth/register/verify', { challengeId, code })).status).toBe(422);
    const body = { setupToken: verified.body.setupToken, password: NEW_PASSWORD };
    const [a, b] = await Promise.all([
      new Client().post('/auth/register/complete', body),
      new Client().post('/auth/register/complete', body),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, expect.any(Number)]);
    expect([a.status, b.status].filter((s) => s === 200)).toHaveLength(1);
    const accounts = await withDb(
      async (db) => (await db.query('SELECT count(*)::int AS n FROM users WHERE login_id = $1', [email])).rows[0].n,
    );
    expect(accounts).toBe(1);
  });

  it('refuses a weak password and keeps the setup open to try again', async () => {
    const email = uniqueEmail();
    const client = new Client();
    const { challengeId } = (await client.post('/auth/register', details(email))).body;
    const { setupToken } = (await client.post('/auth/register/verify', { challengeId, code: await latestCode(email) }))
      .body;
    expect((await client.post('/auth/register/complete', { setupToken, password: 'short' })).status).toBe(422);
    expect((await client.post('/auth/register/complete', { setupToken, password: 'password123' })).status).toBe(422);
    expect((await client.post('/auth/register/complete', { setupToken, password: NEW_PASSWORD })).status).toBe(200);
  });

  it('keeps no readable code, and clears what was typed once the account exists', async () => {
    const email = uniqueEmail();
    const client = new Client();
    const { challengeId } = (await client.post('/auth/register', details(email))).body;
    const code = await latestCode(email);
    const stored = await withDb(
      async (db) =>
        (await db.query('SELECT code_hash, details FROM email_challenges WHERE id = $1', [challengeId])).rows[0],
    );
    expect(stored.code_hash).not.toContain(code);
    expect(stored.code_hash).toMatch(/^[0-9a-f]{64}$/);
    const { setupToken } = (await client.post('/auth/register/verify', { challengeId, code })).body;
    await client.post('/auth/register/complete', { setupToken, password: NEW_PASSWORD });
    const after = await withDb(
      async (db) =>
        (await db.query('SELECT code_hash, details FROM email_challenges WHERE id = $1', [challengeId])).rows[0],
    );
    expect(after).toEqual({ code_hash: null, details: null });
  });

  it('limits code requests per client address', async () => {
    const base = ctx().limitedApi;
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await fetch(`${base}/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ctx().origin, 'x-forwarded-for': ip },
        body: JSON.stringify(details(uniqueEmail('limit'))),
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses[3]).toBe(429);
  });
});

describe('sign-up from the phone app', () => {
  // Native apps send no Origin header and hold no cookie until they have a token.
  const native = (path: string, body: unknown) =>
    fetch(`${ctx().api}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async (res) => ({ status: res.status, body: await res.json() }));

  it('works without an Origin header and ends with a bearer token for this installation', async () => {
    const email = uniqueEmail('phone');
    const started = await native('/auth/register', details(email));
    expect(started.status).toBe(200);
    const verified = await native('/auth/register/verify', {
      challengeId: started.body.challengeId,
      code: await latestCode(email),
    });
    expect(verified.status).toBe(200);
    const done = await native('/auth/register/complete-token', {
      setupToken: verified.body.setupToken,
      password: NEW_PASSWORD,
      installationId: `e2e-native-${Date.now().toString(36)}-installation`,
      platform: 'android',
    });
    expect(done.status).toBe(200);
    const me = await fetch(`${ctx().api}/auth/me`, { headers: { authorization: `Bearer ${done.body.token}` } });
    expect((await me.json()).loginId).toBe(email);
  });

  it('still refuses the cookie-setting web step from an unknown origin', async () => {
    const res = await native('/auth/register/complete', { setupToken: 'x'.repeat(40), password: NEW_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('BAD_ORIGIN');
  });
});

describe('new registrations for administrators', () => {
  it('lists a completed registration once, marks it new, and clears it when opened', async () => {
    const before = (await admin().get('/admin/inbox')).body.newRegistrations as number;
    const { id, email } = await signUp(uniqueEmail('newreg'));
    const inbox = (await admin().get('/admin/inbox')).body;
    expect(inbox.newRegistrations).toBeGreaterThanOrEqual(before + 1);
    const list = (await admin().get(`/admin/registrations?q=${encodeURIComponent(email)}`)).body;
    expect(list.registrations).toHaveLength(1);
    expect(list.registrations[0]).toMatchObject({
      id,
      name: 'Asha Rao',
      email,
      mobile: '+919876543210',
      age: 29,
      emailVerified: true,
      enquiryStatus: 'NOT_CONTACTED',
      subscription: { state: 'NONE' },
      isNew: true,
    });
    expect((await admin().post(`/admin/subscribers/${id}/seen`)).status).toBe(200);
    const again = (await admin().get(`/admin/registrations?q=${encodeURIComponent(email)}`)).body;
    expect(again.registrations[0].isNew).toBe(false);
    // Accounts an administrator created are not registrations.
    const legacy = await newSubscriber(3);
    const none = (await admin().get(`/admin/registrations?q=${encodeURIComponent(legacy.loginId)}`)).body;
    expect(none.registrations).toHaveLength(0);
  });

  it('is for administrators only', async () => {
    const { client } = await signUp();
    expect((await client.get('/admin/registrations')).status).toBe(403);
    expect((await client.get('/admin/inbox')).status).toBe(403);
  });
});

describe('password recovery', () => {
  const startReset = (email: string) => new Client().post('/auth/password-reset', { email });

  it('answers the same for an unknown address and sends nothing to it', async () => {
    const email = uniqueEmail('nobody');
    const res = await startReset(email);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['challengeId', 'email', 'expiresAt', 'resendAvailableAt']);
    expect(mailbox(email)).toHaveLength(0);
    const guess = await new Client().post('/auth/password-reset/verify', {
      challengeId: res.body.challengeId,
      code: '123456',
    });
    expect(guess.status).toBe(422);
  });

  it('files one request after the code, which an administrator answers with a one-time temporary password', async () => {
    const { email, id } = await signUp();
    const old = new Client();
    expect((await old.post('/auth/login', { identifier: email, password: NEW_PASSWORD })).status).toBe(200);

    const before = mailbox(email).length;
    const started = await startReset(email);
    const code = await latestCode(email, before);
    const verified = await new Client().post('/auth/password-reset/verify', {
      challengeId: started.body.challengeId,
      code,
    });
    expect(verified.body).toEqual({ status: 'REQUESTED' });
    // A second request while the first is open is the same request.
    await withDb((db) =>
      db.query("UPDATE email_challenges SET sent_at = now() - interval '61 seconds' WHERE email = $1", [email]),
    );
    const second = await startReset(email);
    await new Client().post('/auth/password-reset/verify', {
      challengeId: second.body.challengeId,
      code: await latestCode(email, before + 1),
    });

    const open = (await admin().get('/admin/password-resets')).body;
    const mine = open.requests.filter((r: { userId: string }) => r.userId === id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ email, emailVerified: true, status: 'OPEN' });

    const issued = await admin().post(`/admin/password-resets/${mine[0].id}/issue`);
    expect(issued.status).toBe(200);
    const temp = issued.body.temporaryPassword as string;
    expect(temp).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect(Date.parse(issued.body.expiresAt) - Date.now()).toBeLessThanOrEqual(24 * 3_600_000);

    // Never shown or stored again, and the old password and sessions stop working.
    const listed = JSON.stringify((await admin().get('/admin/password-resets?status=ALL')).body);
    expect(listed).not.toContain(temp);
    const audit = await withDb(
      async (db) =>
        (
          await db.query(
            "SELECT metadata::text AS m FROM audit_logs WHERE action = 'PASSWORD_RESET_ISSUED' AND target_id = $1",
            [id],
          )
        ).rows,
    );
    expect(audit.length).toBe(1);
    expect(audit[0].m).not.toContain(temp);
    expect((await old.get('/auth/me')).status).toBe(401);
    expect((await new Client().post('/auth/login', { identifier: email, password: NEW_PASSWORD })).status).toBe(401);
    expect((await admin().post(`/admin/password-resets/${mine[0].id}/dismiss`)).status).toBe(200);

    // The temporary password must be replaced before anything else.
    const back = new Client();
    expect((await back.post('/auth/login', { identifier: email, password: temp })).status).toBe(200);
    expect((await back.get('/auth/me')).body.next).toBe('CHANGE_PASSWORD');
    expect((await back.get('/me/notices')).status).toBe(403);
    expect(
      (await back.post('/auth/change-password', { currentPassword: temp, newPassword: 'another private phrase' }))
        .status,
    ).toBe(200);
    expect((await back.get('/auth/me')).body.next).toBeNull();
  });

  it('completes the request when the temporary password is replaced', async () => {
    const { email, id } = await signUp();
    const before = mailbox(email).length;
    const started = await startReset(email);
    await new Client().post('/auth/password-reset/verify', {
      challengeId: started.body.challengeId,
      code: await latestCode(email, before),
    });
    const request = (await admin().get('/admin/password-resets')).body.requests.find(
      (r: { userId: string }) => r.userId === id,
    );
    const temp = (await admin().post(`/admin/password-resets/${request.id}/issue`)).body.temporaryPassword;
    const client = new Client();
    await client.post('/auth/login', { identifier: email, password: temp });
    await client.post('/auth/change-password', { currentPassword: temp, newPassword: 'yet another private phrase' });
    const all = (await admin().get('/admin/password-resets?status=ALL')).body.requests;
    expect(all.find((r: { id: string }) => r.id === request.id).status).toBe('COMPLETED');
  });

  it('refuses an expired temporary password', async () => {
    const { email, id } = await signUp();
    const before = mailbox(email).length;
    const started = await startReset(email);
    await new Client().post('/auth/password-reset/verify', {
      challengeId: started.body.challengeId,
      code: await latestCode(email, before),
    });
    const request = (await admin().get('/admin/password-resets')).body.requests.find(
      (r: { userId: string }) => r.userId === id,
    );
    const temp = (await admin().post(`/admin/password-resets/${request.id}/issue`)).body.temporaryPassword;
    await withDb((db) =>
      db.query("UPDATE users SET temp_password_expires_at = now() - interval '1 minute' WHERE id = $1", [id]),
    );
    const res = await new Client().post('/auth/login', { identifier: email, password: temp });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TEMP_PASSWORD_EXPIRED');
  });

  it('only administrators handle requests', async () => {
    const { client } = await signUp();
    expect((await client.get('/admin/password-resets')).status).toBe(403);
    expect((await client.post('/admin/password-resets/00000000-0000-4000-8000-000000000000/issue')).status).toBe(403);
  });
});
