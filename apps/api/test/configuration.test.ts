import { randomUUID } from 'node:crypto';
import { generate } from 'otplib';
import { describe, expect, it } from 'vitest';
import { admin, Client, PASSWORD, uniqueId, withDb } from './helpers.js';

/* The Super Admin's configuration screen: the email account, sign-up switch and trial length, all without a code
 * change, and none of it readable by anyone else. */

const PASSWORD_PLAIN = 'app-password-for-tests-1234';

async function newAdmin() {
  const loginId = uniqueId('cfg');
  const created = await admin().post('/admin/admins', { name: 'Desk Admin', loginId, idempotencyKey: randomUUID() });
  expect(created.status).toBe(201);
  const client = new Client();
  const temp = created.body.temporaryPassword as string;
  await client.post('/auth/login', { identifier: loginId, password: temp });
  await client.post('/auth/change-password', { currentPassword: temp, newPassword: PASSWORD });
  const setup = await client.post('/auth/mfa/setup', {});
  await client.post('/auth/mfa/enable', { code: await generate({ secret: setup.body.secret }) });
  return client;
}

async function savedSettings() {
  const { id: _i, updatedAt: _u, dataResetAt: _r, ...fields } = (await admin().get('/admin/settings')).body;
  return fields as Record<string, unknown>;
}

/** Puts the email account back as it was, so the rest of the suite is unaffected. */
async function restoreEmail(before: Record<string, unknown>) {
  const { enabled, host, port, security, username, fromName, fromAddress } = before;
  const res = await admin().req('PUT', '/admin/settings/email', {
    enabled,
    host,
    port,
    security,
    username,
    fromName,
    fromAddress,
  });
  expect(res.status).toBe(200);
}

const account = {
  enabled: true,
  host: '127.0.0.1',
  // Nothing listens here, so a test email fails quickly and predictably.
  port: 1,
  security: 'STARTTLS',
  username: 'desk@example.test',
  fromName: 'Signal Desk',
  fromAddress: 'desk@example.test',
};

describe('the email account on the configuration screen', () => {
  it('is saved by the Super Admin only, keeps the password encrypted, and never returns it', async () => {
    const before = (await admin().get('/admin/settings/email')).body;
    try {
      // Switched on without a server or sender: refused with field messages.
      const incomplete = await admin().req('PUT', '/admin/settings/email', { ...account, host: '', fromAddress: '' });
      expect(incomplete.status).toBe(422);
      // A username needs a password the first time.
      const noPassword = await admin().req('PUT', '/admin/settings/email', account);
      expect(noPassword.status).toBe(422);
      expect(noPassword.body.error.details.issues[0].field).toBe('password');

      const saved = await admin().req('PUT', '/admin/settings/email', { ...account, password: PASSWORD_PLAIN });
      expect(saved.status).toBe(200);
      expect(saved.body).toMatchObject({ enabled: true, host: '127.0.0.1', passwordSet: true, testedAt: null });
      expect(JSON.stringify(saved.body)).not.toContain(PASSWORD_PLAIN);

      // Not readable in plain text anywhere: the API, the general settings, the database or the audit log.
      const read = await admin().get('/admin/settings/email');
      expect(JSON.stringify(read.body)).not.toContain(PASSWORD_PLAIN);
      const general = await admin().get('/admin/settings');
      expect(JSON.stringify(general.body)).not.toMatch(/smtp|password/i);
      const stored = await withDb((db) => db.query('SELECT smtp_password_enc FROM app_settings WHERE id = 1'));
      expect(stored.rows[0].smtp_password_enc).toBeTruthy();
      expect(stored.rows[0].smtp_password_enc).not.toContain(PASSWORD_PLAIN);
      const log = await admin().get('/admin/audit?action=EMAIL_SETTINGS_UPDATED');
      expect(log.body.entries[0].metadata).toMatchObject({ passwordChanged: true, host: { to: '127.0.0.1' } });
      expect(JSON.stringify(log.body)).not.toContain(PASSWORD_PLAIN);

      // Saving again without a password keeps the saved one.
      const kept = await admin().req('PUT', '/admin/settings/email', { ...account, fromName: 'Desk' });
      expect(kept.body.passwordSet).toBe(true);

      // Another administrator can neither read nor change it, nor send a test.
      const other = await newAdmin();
      expect((await other.get('/admin/settings/email')).status).toBe(403);
      expect((await other.req('PUT', '/admin/settings/email', account)).status).toBe(403);
      expect((await other.post('/admin/settings/email/test', { to: 'a@example.test' })).status).toBe(403);
    } finally {
      await restoreEmail(before);
    }
  });

  it('sends a test email and explains a failure in plain words', async () => {
    const before = (await admin().get('/admin/settings/email')).body;
    try {
      await admin().req('PUT', '/admin/settings/email', { ...account, password: PASSWORD_PLAIN });
      const test = await admin().post('/admin/settings/email/test', { to: 'owner@example.test' });
      expect(test.status).toBe(422);
      expect(test.body.error.code).toBe('EMAIL_TEST_FAILED');
      expect(test.body.error.message).toContain('Could not connect to 127.0.0.1 on port 1');
      expect(JSON.stringify(test.body)).not.toContain(PASSWORD_PLAIN);
      expect((await admin().get('/admin/audit?action=EMAIL_TEST_FAILED')).body.entries[0].metadata.to).toBe(
        'ow•••@example.test',
      );
      expect((await admin().post('/admin/settings/email/test', { to: 'not an address' })).status).toBe(422);
    } finally {
      await restoreEmail(before);
    }
  });
});

describe('sign-up switch and trial length', () => {
  it('pauses sign-up for everyone, says so before anything is typed, and reopens', async () => {
    const original = await savedSettings();
    // Tests send email to files, which counts as the server's own configuration.
    expect((await new Client().get('/public/info')).body).toMatchObject({ signupOpen: true, signupAvailable: true });
    try {
      const closed = await admin().req('PUT', '/admin/settings', {
        ...original,
        signupOpen: false,
        defaultTrialDays: 5,
      });
      expect(closed.status).toBe(200);
      expect(closed.body).toMatchObject({ signupOpen: false, defaultTrialDays: 5 });
      expect((await new Client().get('/public/info')).body).toMatchObject({
        signupOpen: false,
        signupAvailable: false,
      });
      const attempt = await new Client().post('/auth/register', {
        firstName: 'Asha',
        lastName: 'Rao',
        email: `${uniqueId('closed')}@example.test`,
        mobile: '+91 98765 43210',
        age: 30,
        consent: true,
      });
      expect(attempt.status).toBe(403);
      expect(attempt.body.error.code).toBe('SIGNUP_CLOSED');
      const log = await admin().get('/admin/audit?action=SETTINGS_UPDATED');
      expect(log.body.entries[0].metadata.rules.signupOpen).toEqual({ from: true, to: false });

      expect((await admin().req('PUT', '/admin/settings', { ...original, defaultTrialDays: 91 })).status).toBe(422);
    } finally {
      await admin().req('PUT', '/admin/settings', original);
    }
  });
});
