import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { admin, Client, newSubscriber, PASSWORD, publish, uniqueId, waitUntil, withDb } from './helpers.js';
import { mailbox, NEW_PASSWORD, signUp } from './onboarding.js';

const start = (id: string, body: Record<string, unknown>) =>
  admin().post(`/admin/subscribers/${id}/start`, { idempotencyKey: randomUUID(), ...body });
const trial = (id: string, body: Record<string, unknown>) =>
  admin().post(`/admin/subscribers/${id}/trial`, { idempotencyKey: randomUUID(), ...body });
const endNow = (id: string) =>
  withDb((db) =>
    db.query(
      "UPDATE subscriptions SET starts_at = now() - interval '10 days', expires_at = now() - interval '1 second' WHERE user_id = $1",
      [id],
    ),
  );

/** "20 December 2026" for the last day of a window ending at this instant, in the business timezone. */
const lastDay = (expiresAt: string) =>
  new Date(Date.parse(expiresAt) - 1).toLocaleDateString('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

describe('subscription enquiries', () => {
  it('opens WhatsApp with the account details and records only that the link was opened', async () => {
    const { client, email } = await signUp();
    const key = randomUUID();
    const res = await client.post('/me/enquiries', { channel: 'WHATSAPP', idempotencyKey: key });
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('LINK_OPENED');
    const link = new URL(res.body.whatsappLink);
    expect(`${link.origin}${link.pathname}`).toBe('https://wa.me/919987255414');
    const text = link.searchParams.get('text') as string;
    expect(text).toContain('Name: Asha Rao');
    expect(text).toContain(`Registered Email: ${email}`);
    expect(text).toContain('Registered Mobile: +919876543210');
    expect(text).not.toMatch(/age|password|code/i);
    expect(res.body.whatsappAppLink).toMatch(/^whatsapp:\/\/send\?phone=919987255414&text=/);
    expect((await client.get('/auth/me')).body.enquiryStatus).toBe('INITIATED');
    // A repeat of the same request is the same enquiry.
    const again = await client.post('/me/enquiries', { channel: 'WHATSAPP', idempotencyKey: key });
    expect(again.body).toMatchObject({ id: res.body.id, replayed: true });
  });

  it('emails support from the server, once however often it is tapped, and reports what the provider said', async () => {
    const { client, email } = await signUp();
    const support = (await admin().get('/admin/settings')).body.supportEmail as string;
    const before = mailbox(support).length;
    const res = await client.post('/me/enquiries', { channel: 'EMAIL', idempotencyKey: randomUUID() });
    expect(res.status).toBe(200);
    expect(['EMAIL_QUEUED', 'EMAIL_SENT']).toContain(res.body.outcome);
    const repeat = await client.post('/me/enquiries', { channel: 'EMAIL', idempotencyKey: randomUUID() });
    expect(repeat.body).toMatchObject({ id: res.body.id, replayed: true });

    const mail = await waitUntil(() =>
      mailbox(support)
        .slice(before)
        .find((m) => m.text.includes(email)),
    );
    expect(mail.subject).toBe('SignalDesk — New Subscription Enquiry');
    expect(mail.replyTo).toBe(email);
    for (const part of [
      'Name: Asha Rao',
      `Registered email: ${email}`,
      'Registered mobile: +919876543210',
      'Enquiry source: Email Fallback',
      'Current status: No active subscription',
    ]) {
      expect(mail.text).toContain(part);
    }
    expect(
      mailbox(support)
        .slice(before)
        .filter((m) => m.text.includes(email)),
    ).toHaveLength(1);
    const status = await waitUntil(async () => {
      const s = (await client.get(`/me/enquiries/${res.body.id}`)).body;
      return s.outcome === 'EMAIL_SENT' ? s : null;
    });
    expect(status.outcome).toBe('EMAIL_SENT');
  });

  it('administrators move the enquiry along, and the subscriber sees where it stands', async () => {
    const { client, id } = await signUp();
    const set = await admin().req('PUT', `/admin/subscribers/${id}/enquiry`, { status: 'UNDER_DISCUSSION' });
    expect(set.status).toBe(200);
    expect(set.body.enquiryStatus).toBe('UNDER_DISCUSSION');
    expect((await client.get('/auth/me')).body.enquiryStatus).toBe('UNDER_DISCUSSION');
    expect((await client.req('PUT', `/admin/subscribers/${id}/enquiry`, { status: 'RESOLVED' })).status).toBe(403);
  });
});

describe('support contact settings', () => {
  it('only the Master Admin changes them, every screen reads the new values at once, and the change is audited', async () => {
    const original = (await admin().get('/admin/settings')).body;
    const { client } = await signUp();
    try {
      const updated = await admin().req('PUT', '/admin/settings/support', {
        supportWhatsapp: '+91 90000 12345',
        supportEmail: 'Help.Desk@Example.test',
      });
      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({ supportWhatsapp: '+919000012345', supportEmail: 'help.desk@example.test' });
      expect((await client.get('/auth/me')).body.support).toMatchObject({
        whatsapp: '+919000012345',
        email: 'help.desk@example.test',
      });
      const link = (await client.post('/me/enquiries', { channel: 'WHATSAPP', idempotencyKey: randomUUID() })).body
        .whatsappLink as string;
      expect(link.startsWith('https://wa.me/919000012345?text=')).toBe(true);
      expect((await new Client().get('/public/info')).body).toMatchObject({ supportWhatsapp: '+919000012345' });
      const log = await admin().get('/admin/audit?action=SUPPORT_CONTACT_UPDATED');
      expect(log.body.entries[0].metadata.whatsapp).toEqual({ from: original.supportWhatsapp, to: '+919000012345' });

      const invalid = await admin().req('PUT', '/admin/settings/support', { supportWhatsapp: '12', supportEmail: 'x' });
      expect(invalid.status).toBe(422);
      expect(
        (
          await client.req('PUT', '/admin/settings/support', {
            supportWhatsapp: '+919000012345',
            supportEmail: 'a@b.co',
          })
        ).status,
      ).toBe(403);
    } finally {
      await admin().req('PUT', '/admin/settings/support', {
        supportWhatsapp: original.supportWhatsapp,
        supportEmail: original.supportEmail,
      });
    }
  });
});

describe('starting and renewing subscriptions', () => {
  it('starts any number of days, notifies the subscriber, and resolves their enquiry', async () => {
    const { client, id, email } = await signUp();
    await client.post('/me/enquiries', { channel: 'WHATSAPP', idempotencyKey: randomUUID() });
    const key = randomUUID();
    const res = await admin().post(`/admin/subscribers/${id}/start`, { durationDays: 37, idempotencyKey: key });
    expect(res.status).toBe(201);
    const sub = res.body.subscriber;
    expect(sub.subscription).toMatchObject({ state: 'ACTIVE', kind: 'PAID', daysRemaining: 37 });
    expect(sub.enquiryStatus).toBe('RESOLVED');
    expect(sub.actions).toEqual(['RENEW', 'GRANT_TRIAL']);
    // Retrying the same request changes nothing.
    const replay = await admin().post(`/admin/subscribers/${id}/start`, { durationDays: 37, idempotencyKey: key });
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.subscriber.events).toHaveLength(1);

    expect((await client.get('/auth/me')).body.access.allowed).toBe(true);
    expect((await client.get('/feed')).status).toBe(200);
    const notices = (await client.get('/me/notices')).body.notices;
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ kind: 'SUBSCRIPTION_STARTED', title: 'Subscription Activated', read: false });
    expect(notices[0].body).toContain('active for 37 days');
    expect(notices[0].body).toContain(`Valid until: ${lastDay(sub.subscription.expiresAt)}`);
    const mail = await waitUntil(() => mailbox(email).find((m) => m.subject.includes('Subscription Activated')));
    expect(mail.text).toContain('active for 37 days');
    expect((await client.post('/me/notices/read')).body.marked).toBe(1);
    expect((await client.get('/me/notices')).body.notices[0].read).toBe(true);
  });

  it('refuses zero, fractional and oversized durations, and a start on running paid access', async () => {
    const { id } = await signUp();
    for (const durationDays of [0, -3, 2.5, 3661]) {
      expect((await start(id, { durationDays })).status, String(durationDays)).toBe(422);
    }
    expect((await start(id, { durationDays: 10 })).status).toBe(201);
    const twice = await start(id, { durationDays: 10 });
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('SUBSCRIPTION_RUNNING');
  });

  it('two administrators starting at once give one subscription', async () => {
    const { id } = await signUp();
    const [a, b] = await Promise.all([start(id, { durationDays: 10 }), start(id, { durationDays: 20 })]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
  });

  it('renews an expired subscription from the chosen date and restores access', async () => {
    const { client, id } = await signUp();
    await start(id, { durationDays: 5 });
    await endNow(id);
    expect((await client.get('/auth/me')).body.access).toEqual({ allowed: false, reason: 'SUBSCRIPTION_EXPIRED' });
    expect((await client.get('/feed')).status).toBe(403);

    const renewed = await admin().post(`/admin/subscribers/${id}/renew`, {
      durationDays: 30,
      idempotencyKey: randomUUID(),
    });
    expect(renewed.status).toBe(201);
    expect(renewed.body.subscriber.events[0].mode).toBe('RESTARTED_FROM_NOW');
    expect((await client.get('/auth/me')).body.access.allowed).toBe(true);
    const notices = (await client.get('/me/notices')).body.notices;
    expect(notices[0]).toMatchObject({ kind: 'SUBSCRIPTION_RENEWED', title: 'Subscription Renewed' });

    await endNow(id);
    const later = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const fromDate = await admin().post(`/admin/subscribers/${id}/renew`, {
      durationDays: 7,
      activationDate: later,
      idempotencyKey: randomUUID(),
    });
    expect(fromDate.body.subscriber.events[0].mode).toBe('RESTARTED_FROM_DATE');
    expect(fromDate.body.subscriber.subscription.state).toBe('SCHEDULED');
  });

  it('extends a running subscription from its expiry and never shortens it', async () => {
    const { id } = await signUp();
    const started = (await start(id, { durationDays: 30 })).body.subscriber.subscription;
    const renewed = await admin().post(`/admin/subscribers/${id}/renew`, {
      durationDays: 1,
      idempotencyKey: randomUUID(),
    });
    expect(renewed.body.subscriber.events[0].mode).toBe('EXTENDED_FROM_EXPIRY');
    expect(Date.parse(renewed.body.subscriber.subscription.expiresAt)).toBeGreaterThan(Date.parse(started.expiresAt));
  });
});

describe('free trials', () => {
  it('are granted for any number of days, welcomed once across devices, and notified', async () => {
    const { client, id, email } = await signUp();
    const res = await trial(id, { durationDays: 5, note: 'Referral' });
    expect(res.status).toBe(201);
    expect(res.body.subscriber.subscription).toMatchObject({ state: 'ACTIVE', kind: 'TRIAL', daysRemaining: 5 });
    expect(res.body.subscriber.trials[0]).toMatchObject({ durationDays: 5, note: 'Referral' });

    const me = (await client.get('/auth/me')).body;
    expect(me.access.allowed).toBe(true);
    expect(me.trialGreeting).toMatchObject({ durationDays: 5, lastValidDate: me.subscription.lastValidDate });
    expect((await client.get('/feed')).status).toBe(200);

    // A second device signed in before the welcome was acknowledged sees it too; after, neither does.
    const other = new Client();
    await other.post('/auth/login', { identifier: email, password: NEW_PASSWORD });
    expect((await other.get('/auth/me')).body.trialGreeting.grantId).toBe(me.trialGreeting.grantId);
    expect((await client.post(`/me/trial-greeting/${me.trialGreeting.grantId}`)).status).toBe(200);
    expect((await client.get('/auth/me')).body.trialGreeting).toBeNull();
    expect((await other.get('/auth/me')).body.trialGreeting).toBeNull();

    const notices = (await client.get('/me/notices')).body.notices;
    expect(notices[0]).toMatchObject({ kind: 'TRIAL_GRANTED', title: 'Your Free Trial Is Ready!' });
    expect(notices[0].body).toContain("You've received 5 days of access");
    await waitUntil(() => mailbox(email).find((m) => m.subject.includes('Your Free Trial Is Ready!')));
  });

  it('can be given to anyone, as often as needed: running access is extended, ended access starts again', async () => {
    const { id, client } = await signUp();
    expect((await trial(id, { durationDays: 3 })).status).toBe(201);
    // A second grant while the first runs adds its days after the current end.
    const more = await trial(id, { durationDays: 2 });
    expect(more.status).toBe(201);
    expect(more.body.subscriber.subscription).toMatchObject({ kind: 'TRIAL', daysRemaining: 5 });
    expect((await client.get('/me/notices')).body.notices[0]).toMatchObject({ title: 'Free Days Added!' });
    // After it ends, another trial starts again from today, with no extra confirmation.
    await endNow(id);
    const again = await trial(id, { durationDays: 3 });
    expect(again.status).toBe(201);
    expect(again.body.subscriber.subscription).toMatchObject({ state: 'ACTIVE', kind: 'TRIAL', daysRemaining: 3 });
    expect((await trial(id, { durationDays: 91 })).status).toBe(422);
  });

  it('give an existing paying member free days after their paid days, and keep them a paying member', async () => {
    const { id, client } = await newSubscriber(30);
    const res = await trial(id, { durationDays: 7, note: 'Goodwill' });
    expect(res.status).toBe(201);
    expect(res.body.subscriber.subscription).toMatchObject({ state: 'ACTIVE', kind: 'PAID', daysRemaining: 37 });
    const me = (await client.get('/auth/me')).body;
    expect(me.trialGreeting).toMatchObject({ durationDays: 7, lastValidDate: me.subscription.lastValidDate });
    const notice = (await client.get('/me/notices')).body.notices[0];
    expect(notice).toMatchObject({ kind: 'TRIAL_GRANTED', title: 'Free Days Added!' });
    expect(notice.body).toContain("You've received 7 free days");
  });

  it('after the trial ends: sign-in still works, no greeting, no new signals, and the renewal screen state', async () => {
    const { client, id, email } = await signUp();
    await trial(id, { durationDays: 2 });
    await endNow(id);
    const me = (await client.get('/auth/me')).body;
    expect(me.access).toEqual({ allowed: false, reason: 'SUBSCRIPTION_EXPIRED' });
    expect(me.subscription.kind).toBe('TRIAL');
    expect(me.trialGreeting).toBeNull();
    const trade = await publish();
    expect((await client.get('/feed')).status).toBe(403);
    expect((await client.get(`/trades/${trade.id}`)).status).toBe(403);
    expect((await client.get('/trades/active')).status).toBe(403);
    const fresh = new Client();
    expect((await fresh.post('/auth/login', { identifier: email, password: NEW_PASSWORD })).status).toBe(200);
    // Account messages still reach them.
    expect((await fresh.get('/me/notices')).status).toBe(200);
  });

  it('a subscription replaces a running trial, with confirmation if it would end sooner', async () => {
    const { id } = await signUp();
    await trial(id, { durationDays: 30 });
    const shorter = await start(id, { durationDays: 3 });
    expect(shorter.status).toBe(409);
    expect(shorter.body.error.code).toBe('SHORTENS_ACCESS');
    const confirmed = await start(id, { durationDays: 3, confirmShorter: true });
    expect(confirmed.status).toBe(201);
    expect(confirmed.body.subscriber.subscription).toMatchObject({ kind: 'PAID', daysRemaining: 3 });
    // A trial is not renewed; and a paid subscription is.
    const { id: other } = await signUp();
    await trial(other, { durationDays: 3 });
    const renew = await admin().post(`/admin/subscribers/${other}/renew`, {
      durationDays: 3,
      idempotencyKey: randomUUID(),
    });
    expect(renew.status).toBe(409);
  });

  it('are never available to a subscriber themselves', async () => {
    const { client, id } = await signUp();
    expect(
      (await client.post(`/admin/subscribers/${id}/trial`, { durationDays: 5, idempotencyKey: randomUUID() })).status,
    ).toBe(403);
    expect(
      (await client.post(`/admin/subscribers/${id}/start`, { durationDays: 5, idempotencyKey: randomUUID() })).status,
    ).toBe(403);
  });
});

describe('older accounts', () => {
  it('keep working, and their subscription counts as paid', async () => {
    const legacy = await newSubscriber(10);
    const me = (await legacy.client.get('/auth/me')).body;
    expect(me.subscription.kind).toBe('PAID');
    expect(me.access.allowed).toBe(true);
    expect((await new Client().post('/auth/login', { identifier: legacy.loginId, password: PASSWORD })).status).toBe(
      200,
    );
    const detail = (await admin().get(`/admin/subscribers/${legacy.id}`)).body;
    expect(detail).toMatchObject({ selfRegistered: false, emailVerifiedAt: null, actions: ['RENEW', 'GRANT_TRIAL'] });
    expect(uniqueId()).toBeTruthy();
  });
});
