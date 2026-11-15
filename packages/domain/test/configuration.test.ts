import { describe, expect, it } from 'vitest';
import {
  ADMIN_SETTINGS_FIELDS,
  type AdminSettings,
  emailPresetFor,
  emailSettingsSchema,
  grantTrialWindow,
  lastValidLocalDate,
  settingsBody,
  settingsSchema,
  signupAvailable,
} from '../src/index.js';

const IST = 'Asia/Kolkata';
const at = (iso: string) => new Date(iso);
const NOW = at('2026-11-15T06:30:00Z'); // noon IST

describe('free days for any member', () => {
  it('starts a trial for someone with no access, or whose access ended', () => {
    const none = grantTrialWindow(null, 5, NOW, IST);
    expect(none).toMatchObject({ mode: 'STARTED', kind: 'TRIAL', startsAt: NOW });
    expect(lastValidLocalDate(none.expiresAt, IST)).toBe('2026-11-19');
    const ended = {
      startsAt: at('2026-10-01T00:00:00Z'),
      expiresAt: at('2026-11-01T18:30:00Z'),
      kind: 'PAID' as const,
    };
    expect(grantTrialWindow(ended, 3, NOW, IST)).toMatchObject({ mode: 'STARTED', kind: 'TRIAL' });
  });

  it('adds the days after the last day of running access, keeping a paying member paid', () => {
    const paid = { startsAt: at('2026-11-01T00:00:00Z'), expiresAt: at('2026-11-30T18:30:00Z'), kind: 'PAID' as const };
    const extended = grantTrialWindow(paid, 7, NOW, IST);
    expect(extended).toMatchObject({ mode: 'EXTENDED', kind: 'PAID', startsAt: paid.startsAt });
    expect(lastValidLocalDate(extended.expiresAt, IST)).toBe('2026-12-07');
    const trial = { ...paid, kind: 'TRIAL' as const };
    expect(grantTrialWindow(trial, 2, NOW, IST)).toMatchObject({ mode: 'EXTENDED', kind: 'TRIAL' });
  });

  it('starts on a later chosen date, never in the past, and refuses more than 90 days', () => {
    const later = at('2026-11-20T18:30:00Z');
    expect(grantTrialWindow(null, 5, NOW, IST, later).startsAt).toEqual(later);
    expect(grantTrialWindow(null, 5, NOW, IST, at('2026-11-01T00:00:00Z')).startsAt).toEqual(NOW);
    expect(() => grantTrialWindow(null, 91, NOW, IST)).toThrow();
  });
});

describe('the email account', () => {
  const valid = {
    enabled: true,
    host: 'SMTP.Gmail.com ',
    port: 587,
    security: 'STARTTLS',
    username: 'desk@gmail.com',
    password: 'abcd efgh ijkl mnop',
    fromName: 'Signal Desk',
    fromAddress: 'desk@gmail.com',
  };

  it('accepts a complete account, tidying the server name', () => {
    const parsed = emailSettingsSchema.parse(valid);
    expect(parsed.host).toBe('smtp.gmail.com');
    expect(emailPresetFor(parsed.host)).toBe('GMAIL');
    expect(emailPresetFor('mail.example.test')).toBe('OTHER');
  });

  it('needs a server and a sender only when switched on', () => {
    const on = emailSettingsSchema.safeParse({ ...valid, host: '', fromAddress: '' });
    expect(on.success).toBe(false);
    expect(on.error?.issues.map((i) => i.path[0])).toEqual(['host', 'fromAddress']);
    expect(emailSettingsSchema.safeParse({ ...valid, enabled: false, host: '', fromAddress: '' }).success).toBe(true);
    expect(emailSettingsSchema.safeParse({ ...valid, host: 'not a host' }).success).toBe(false);
    expect(emailSettingsSchema.safeParse({ ...valid, port: 70000 }).success).toBe(false);
  });

  it('sign-up is available only when it is open and email can be sent', () => {
    expect(signupAvailable(true, 'READY')).toBe(true);
    expect(signupAvailable(true, 'SERVER')).toBe(true);
    expect(signupAvailable(true, 'NOT_SET_UP')).toBe(false);
    expect(signupAvailable(false, 'READY')).toBe(false);
  });
});

describe('saving settings', () => {
  it('sends back exactly the savable fields, which the server accepts', () => {
    const current = {
      ...Object.fromEntries(ADMIN_SETTINGS_FIELDS.map((k) => [k, ''])),
      serviceName: 'SignalDesk',
      businessTimezone: IST,
      signalStartMode: 'AWAITING_ENTRY',
      entryExpiryMinutesDefault: 240,
      trailingStopWording: 'GENERAL',
      screenshotsAllowedDefault: false,
      historyScope: 'MEMBERSHIP',
      supportWhatsapp: '+919987255414',
      supportEmail: 'help@example.test',
      signupOpen: true,
      defaultTrialDays: 7,
      id: 1,
      updatedAt: '2026-11-15T00:00:00.000Z',
      dataResetAt: null,
    } as unknown as AdminSettings;
    const body = settingsBody(current, { signupOpen: false });
    expect(Object.keys(body).sort()).toEqual([...ADMIN_SETTINGS_FIELDS].sort());
    expect(body.signupOpen).toBe(false);
    expect(settingsSchema.safeParse(body).success).toBe(true);
  });
});
